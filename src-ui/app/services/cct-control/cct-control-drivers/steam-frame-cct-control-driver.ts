import { invoke } from '@tauri-apps/api/core';
import { warn } from '@tauri-apps/plugin-log';
import { isEqual } from 'lodash';
import {
  combineLatest,
  debounceTime,
  distinctUntilChanged,
  from,
  map,
  Observable,
  ReplaySubject,
  shareReplay,
} from 'rxjs';
import { OVRDevice } from '../../../models/ovr-device';
import {
  SteamFrameCct,
  SteamFrameConnectionState,
  SteamFramePairing,
} from '../../../models/steam-frame';
import type { OpenVRService, OpenVRStatus } from '../../openvr.service';
import type { SteamFramePairingService } from '../../steam-frame-pairing.service';
import { CctControlDriver } from './cct-control-driver';

/** A Frame report that carries a value. */
type FrameCct = SteamFrameCct & { kelvin: number };

/**
 * The active HMD. A Frame model goes through its helper only, and `cct` stays null until this
 * PC's paired Frame reports one.
 */
type ActiveHmd =
  { kind: 'none' | 'other' } | { kind: 'frame'; pairingId: string | null; cct: FrameCct | null };

/** Sets a paired Steam Frame's color temperature through its helper, which also reports it. */
export class SteamFrameCctControlDriver extends CctControlDriver {
  readonly name = 'Steam Frame helper';
  override readonly skipsTransitions = true;
  /** Replays the latest value, which can arrive before the driver becomes the active one. */
  private readonly updates = new ReplaySubject<number>(1);
  override readonly cctUpdates = this.updates.asObservable();
  private readonly hmd: Observable<ActiveHmd>;
  private readonly matching: Observable<boolean>;
  private readonly available: Observable<boolean>;
  private currentHmd: ActiveHmd = { kind: 'none' };
  /** The value last sent to `cctUpdates`. */
  private shown: number | null = null;
  /** False while the Frame's gains lie off the curve, so a set to the shown value still writes. */
  private exact = true;
  /** Set while a command runs; a newer value waits in `pending` and replaces an older one. */
  private sending = false;
  /** Also holds a value set before the paired Frame's first report, which goes out with it. */
  private pending: { kelvin: number; pairingId: string } | null = null;

  constructor(
    openvr: Pick<OpenVRService, 'status' | 'devices'>,
    steamFrames: Pick<SteamFramePairingService, 'pairings$' | 'connections$'>
  ) {
    super();
    const frameModels = from(
      invoke<{ manufacturer: string; model: string }[]>('steam_frame_get_supported_models').catch(
        () => []
      )
    );
    const openvrHmd = combineLatest([openvr.status, openvr.devices]).pipe(debounceTime(100));
    this.hmd = combineLatest([
      openvrHmd,
      steamFrames.pairings$,
      steamFrames.connections$,
      frameModels,
    ]).pipe(
      map(([[status, devices], pairings, connections, frameModels]) =>
        this.activeHmd(status, devices, pairings, connections, frameModels)
      ),
      distinctUntilChanged(isEqual),
      shareReplay(1)
    );
    this.matching = this.hmd.pipe(
      map((hmd) => hmd.kind === 'frame'),
      distinctUntilChanged(),
      shareReplay(1)
    );
    this.available = this.hmd.pipe(
      map((hmd) => hmd.kind === 'frame' && !!hmd.pairingId && !!hmd.cct),
      distinctUntilChanged(),
      shareReplay(1)
    );
    this.hmd.subscribe((hmd) => this.onHmd(hmd));
  }

  matches(): Observable<boolean> {
    return this.matching;
  }

  isAvailable(): Observable<boolean> {
    return this.available;
  }

  async setCCT(kelvin: number): Promise<void> {
    const hmd = this.currentHmd;
    if (hmd.kind !== 'frame' || !hmd.pairingId) return;
    if (hmd.cct && kelvin === this.shown && this.exact) return;
    this.pending = { kelvin, pairingId: hmd.pairingId };
    if (!hmd.cct) return;
    this.show(kelvin);
    if (!this.sending) void this.sendPending();
  }

  private async sendPending() {
    this.sending = true;

    // send the newest value until none waits
    let applied: SteamFrameCct | null = null;
    let sentTo: string | null = null;
    while (this.pending !== null) {
      // a value queued for a Frame that stopped being active is dropped
      const target = this.currentHmd;
      const next = this.pending;
      if (target.kind !== 'frame' || !target.cct || target.pairingId !== next.pairingId) break;
      this.pending = null;
      sentTo = next.pairingId;
      applied = await invoke<SteamFrameCct>('steam_frame_set_cct', {
        pairingId: sentTo,
        kelvin: next.kelvin,
      }).catch((e) => {
        warn(`[CCTControl] Could not set the Steam Frame color temperature: ${e}`);
        return null;
      });
    }
    this.sending = false;

    // show what the active headset holds now; a reply from a Frame that stopped being active is stale
    const target = this.currentHmd;
    if (target.kind !== 'frame' || !target.cct) return;
    const replyApplies = applied?.kelvin != null && sentTo === target.pairingId;
    this.adopt(replyApplies ? (applied as FrameCct) : target.cct);
  }

  private activeHmd(
    status: OpenVRStatus,
    devices: OVRDevice[],
    pairings: SteamFramePairing[],
    connections: Record<string, SteamFrameConnectionState>,
    frameModels: { manufacturer: string; model: string }[]
  ): ActiveHmd {
    const ready = status === 'INITIALIZED' && devices.find((d) => d.index === 0)?.class === 'HMD';
    if (!ready) return { kind: 'none' };
    const hmd = devices.find((d) => d.class === 'HMD');
    const pairing = pairings.find((p) => p.complete && p.identity.serial === hmd?.serialNumber);
    const isFrameModel = frameModels.some(
      (m) => m.manufacturer === hmd?.manufacturerName && m.model === hmd?.modelNumber
    );
    if (!pairing && !isFrameModel) return { kind: 'other' };
    const state = pairing ? connections[pairing.id] : undefined;
    const cct = state?.status === 'connected' ? state.cct : null;
    const reported = cct?.available && cct.kelvin !== null ? (cct as FrameCct) : null;
    return { kind: 'frame', pairingId: pairing?.id ?? null, cct: reported };
  }

  /** Adopts each report, unless a command runs: then the requested value stays on screen. */
  private onHmd(hmd: ActiveHmd) {
    this.currentHmd = hmd;

    // a waiting value belongs to the Frame it was set for
    const pending = this.pending;
    if (pending && (hmd.kind !== 'frame' || hmd.pairingId !== pending.pairingId)) {
      this.pending = null;
    }
    if (hmd.kind !== 'frame' || !hmd.cct || this.sending) return;

    // a value set before the first report goes out with it
    if (this.pending) {
      this.show(this.pending.kelvin);
      void this.sendPending();
      return;
    }
    this.adopt(hmd.cct);
  }

  private adopt(cct: FrameCct) {
    this.exact = !!cct.exact;
    this.show(cct.kelvin);
  }

  private show(kelvin: number) {
    this.shown = kelvin;
    this.updates.next(kelvin);
  }
}
