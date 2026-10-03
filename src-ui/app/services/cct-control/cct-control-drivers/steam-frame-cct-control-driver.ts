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
  STEAM_FRAME_WAITING_SET_MS,
} from '../../../models/steam-frame';
import type { OpenVRService, OpenVRStatus } from '../../openvr.service';
import { SteamFrameCctFade } from '../../steam-frame/steam-frame-fade-task';
import type { SteamFramePairingService } from '../../steam-frame/steam-frame-pairing.service';
import { CctControlDriver } from './cct-control-driver';

/** The longest fade the helper accepts. */
const MAX_FADE_MS = 24 * 60 * 60 * 1000;

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
  override readonly pushesCctChanges = true;
  /** Replays the latest value, which can arrive before the driver becomes the active one. */
  private readonly updates = new ReplaySubject<number>(1);
  override readonly cctUpdates = this.updates.asObservable();
  private readonly hmd: Observable<ActiveHmd>;
  private readonly matching: Observable<boolean>;
  /** The paired Frame's id while it is the active HMD, null for another HMD, undefined for none. */
  readonly activePairing: Observable<string | null | undefined>;
  private readonly available: Observable<boolean>;
  private currentHmd: ActiveHmd = { kind: 'none' };
  /** The value last sent to `cctUpdates`. */
  private shown: number | null = null;
  /** False while the Frame's gains lie off the curve, so a set to the shown value still writes. */
  private exact = true;
  /** Set while a command runs; a newer value waits in `pending` and replaces an older one. */
  private sending = false;
  /** Also holds a value set while the paired Frame cannot take it, which goes out once it can. */
  private pending: { kelvin: number; pairingId: string; setAt: number } | null = null;

  constructor(
    openvr: Pick<OpenVRService, 'status' | 'devices'>,
    private readonly steamFrames: Pick<
      SteamFramePairingService,
      'pairings$' | 'connections$' | 'fadeEnded$'
    >
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
    this.activePairing = this.hmd.pipe(
      map((hmd) => (hmd.kind === 'none' ? undefined : hmd.kind === 'frame' ? hmd.pairingId : null)),
      distinctUntilChanged(),
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
    // while a command runs, `shown` holds the request, not the headset's value
    if (!this.sending && hmd.cct && kelvin === this.shown && this.exact) return;
    this.pending = { kelvin, pairingId: hmd.pairingId, setAt: Date.now() };
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

  /**
   * A fade on the active Frame's helper, or null before that Frame reports or when it already
   * holds the value. Drops a waiting set.
   */
  override fade(kelvin: number, durationMs: number): SteamFrameCctFade | null {
    const hmd = this.currentHmd;
    if (hmd.kind !== 'frame' || !hmd.pairingId || !hmd.cct) return null;
    // the helper would hold a fade to the value it already has for the whole duration
    if (kelvin === this.shown && this.exact) return null;
    // a waiting set would go out after the fade and supersede it
    this.pending = null;
    return new SteamFrameCctFade(
      kelvin,
      {
        pairingId: hmd.pairingId,
        control: 'cct',
        target: kelvin,
        durationMs: Math.min(durationMs, MAX_FADE_MS),
      },
      {
        connections$: this.steamFrames.connections$,
        fadeEnded$: this.steamFrames.fadeEnded$,
        activePairing$: this.activePairing,
      }
    );
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

    // a value set while the Frame could not take it goes out now, unless it waited too long
    if (this.pending && Date.now() - this.pending.setAt <= STEAM_FRAME_WAITING_SET_MS) {
      this.show(this.pending.kelvin);
      void this.sendPending();
      return;
    }
    this.pending = null;
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
