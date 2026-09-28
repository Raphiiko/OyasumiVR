import { Injectable } from '@angular/core';
import {
  BehaviorSubject,
  combineLatest,
  debounceTime,
  distinctUntilChanged,
  filter,
  firstValueFrom,
  map,
  Observable,
} from 'rxjs';
import { isEqual } from 'lodash';
import { CCTTransitionTask } from './cct-transition';
import { listen } from '@tauri-apps/api/event';
import {
  SET_BRIGHTNESS_OR_CCT_OPTIONS_DEFAULTS,
  SetBrightnessOrCCTOptions,
} from '../brightness-control/brightness-control-models';
import { CancellableTask } from '../../utils/cancellable-task';
import { info, warn } from '@tauri-apps/plugin-log';
import { invoke } from '@tauri-apps/api/core';
import { getCSSColorForCCT } from 'src-shared-ts/src/cct-utils';
import { OpenVRService, OpenVRStatus } from '../openvr.service';
import { clamp } from '../../utils/number-utils';
import { AppSettingsService } from '../app-settings.service';
import { SteamFramePairingService } from '../steam-frame-pairing.service';
import { OVRDevice } from '../../models/ovr-device';
import {
  SteamFrameCct,
  SteamFrameConnectionState,
  SteamFramePairing,
} from '../../models/steam-frame';

/** A Frame report that carries a value. */
type FrameCct = SteamFrameCct & { kelvin: number };

/**
 * Where CCT goes for the active HMD. A Frame model goes through its helper only, and `cct` stays
 * null until this PC's paired Frame reports one; nothing is written then.
 */
type CctTarget =
  { kind: 'none' | 'openvr' } | { kind: 'frame'; pairingId: string | null; cct: FrameCct | null };

@Injectable({
  providedIn: 'root',
})
export class CCTControlService {
  private _cct: BehaviorSubject<number> = new BehaviorSubject<number>(6600);
  private _activeTransition = new BehaviorSubject<CCTTransitionTask | undefined>(undefined);
  private target = new BehaviorSubject<CctTarget>({ kind: 'none' });
  public readonly activeTransition = this._activeTransition.asObservable();
  public cctCSSColor: string = 'white';
  private cctControlEnabled: boolean = false;
  private initialized = false;
  /** False while a Frame's gains lie off the curve, so a set to the shown value still writes. */
  private exact = true;
  /** Set while a Frame command runs; a newer value waits in `pending` and replaces an older one. */
  private sending = false;
  private pending: number | null = null;

  get cct(): number {
    return this._cct.value;
  }

  public readonly cctStream: Observable<number> = this._cct.asObservable();

  constructor(
    private openvr: OpenVRService,
    private appSettingsService: AppSettingsService,
    private steamFrames: SteamFramePairingService
  ) {}

  async init() {
    const frameModels = await invoke<{ manufacturer: string; model: string }[]>(
      'steam_frame_get_supported_models'
    ).catch(() => []);
    this.appSettingsService.settings.subscribe((settings) => {
      this.cctControlEnabled = settings.cctControlEnabled;
      if (!this.initialized) {
        this.setCCT(this.cct);
        const hmd = combineLatest([this.openvr.status, this.openvr.devices]).pipe(
          debounceTime(100)
        );
        combineLatest([hmd, this.steamFrames.pairings$, this.steamFrames.connections$])
          .pipe(
            map(([[status, devices], pairings, connections]) =>
              this.targetFor(status, devices, pairings, connections, frameModels)
            ),
            distinctUntilChanged(isEqual)
          )
          .subscribe((target) => this.onTarget(target));
      }
      this.initialized = true;
    });
    this._cct.pipe(distinctUntilChanged()).subscribe((cct) => {
      this.cctCSSColor = getCSSColorForCCT(cct);
    });
    await listen<number>('setColorTemperature', async (event) => {
      await this.setCCT(event.payload, { cancelActiveTransition: true });
    });
  }

  transitionCCT(
    temperature: number,
    duration: number,
    options: Partial<SetBrightnessOrCCTOptions> = SET_BRIGHTNESS_OR_CCT_OPTIONS_DEFAULTS
  ): CancellableTask {
    const opt = { ...SET_BRIGHTNESS_OR_CCT_OPTIONS_DEFAULTS, ...(options ?? {}) };
    // no PC loop writes a Frame, so it gets the target in one command
    if (this.target.value.kind === 'frame') {
      this.cancelActiveTransition();
      const task = new CancellableTask(() =>
        this.setCCT(temperature, { cancelActiveTransition: false, logReason: opt.logReason })
      );
      task.start();
      return task;
    }
    if (this._cct.value === temperature) {
      const task = new CancellableTask();
      task.start();
      return task;
    }
    const transition = new CCTTransitionTask(
      this.setCCT.bind(this),
      async () => this.cct,
      temperature,
      duration,
      { logReason: opt.logReason }
    );
    transition.onComplete.subscribe(() => {
      if (transition.isComplete() && this._activeTransition.value === transition)
        this._activeTransition.next(undefined);
    });
    transition.onError.subscribe(() => {
      if (transition.isError() && this._activeTransition.value === transition)
        this._activeTransition.next(undefined);
    });
    if (opt.logReason) {
      info(`[CCTControl] Starting CCT transition (Reason: ${opt.logReason})`);
    }
    this._activeTransition.next(transition);
    transition.start();
    return transition;
  }

  cancelActiveTransition() {
    if (this._activeTransition.value) {
      this._activeTransition.value.cancel();
      this._activeTransition.next(undefined);
    }
  }

  async setCCT(
    cct: number,
    options: Partial<SetBrightnessOrCCTOptions> = SET_BRIGHTNESS_OR_CCT_OPTIONS_DEFAULTS,
    force = false
  ) {
    if (!this.cctControlEnabled) return;
    const opt = { ...SET_BRIGHTNESS_OR_CCT_OPTIONS_DEFAULTS, ...(options ?? {}) };
    cct = clamp(Math.round(cct), 1000, 10000);
    if (opt.cancelActiveTransition) this.cancelActiveTransition();
    const target = this.target.value;
    if (target.kind === 'frame' && !target.cct) return;
    const frame = target.kind === 'frame';
    if (cct === this.cct && !force && (!frame || this.exact)) return;
    this._cct.next(cct);
    if (frame) void this.sendToFrame(cct);
    else if (target.kind === 'openvr') invoke('openvr_set_analog_color_temp', { temperature: cct });
    if (opt.logReason) {
      await info(`[CCTControl] Set CCT to ${cct}K (Reason: ${opt.logReason})`);
    }
  }

  /**
   * Waits for the first report of the Frame that is the active HMD. Null when no Frame is waiting
   * for one; resolves false when that HMD stops being active first.
   */
  whenFrameReports(): Promise<boolean> | null {
    const waiting = this.target.value;
    if (waiting.kind !== 'frame' || waiting.cct) return null;
    return firstValueFrom(
      this.target.pipe(
        filter((target) => target.kind !== 'frame' || !!target.cct),
        map((target) => target.kind === 'frame')
      )
    );
  }

  private targetFor(
    status: OpenVRStatus,
    devices: OVRDevice[],
    pairings: SteamFramePairing[],
    connections: Record<string, SteamFrameConnectionState>,
    frameModels: { manufacturer: string; model: string }[]
  ): CctTarget {
    const ready = status === 'INITIALIZED' && devices.find((d) => d.index === 0)?.class === 'HMD';
    if (!ready) return { kind: 'none' };
    const hmd = devices.find((d) => d.class === 'HMD');
    const pairing = pairings.find((p) => p.complete && p.identity.serial === hmd?.serialNumber);
    const isFrameModel = frameModels.some(
      (m) => m.manufacturer === hmd?.manufacturerName && m.model === hmd?.modelNumber
    );
    if (!pairing && !isFrameModel) return { kind: 'openvr' };
    const state = pairing ? connections[pairing.id] : undefined;
    const cct = state?.status === 'connected' ? state.cct : null;
    const reported = cct?.available && cct.kelvin !== null ? (cct as FrameCct) : null;
    return { kind: 'frame', pairingId: pairing?.id ?? null, cct: reported };
  }

  private onTarget(target: CctTarget) {
    const previous = this.target.value;
    this.target.next(target);

    // write the app's value to an Index or other HMD once it becomes ready
    if (target.kind === 'openvr' && previous.kind === 'none') {
      this.setCCT(this.cct, SET_BRIGHTNESS_OR_CCT_OPTIONS_DEFAULTS, true);
      return;
    }
    if (target.kind !== 'frame' || !target.cct) return;

    // a running transition would write the Frame at every step, so finish it at once
    const transition = this._activeTransition.value;
    if (transition) {
      this.setCCT(transition.targetCCT, { cancelActiveTransition: true });
      return;
    }

    // show the headset's value, unless a command runs: then the requested value stays on screen
    if (!this.sending) this.adopt(target.cct);
  }

  private adopt(cct: FrameCct) {
    this.exact = !!cct.exact;
    this._cct.next(cct.kelvin);
  }

  private async sendToFrame(kelvin: number) {
    this.pending = kelvin;
    if (this.sending) return;
    this.sending = true;

    // send the newest value until none waits
    let applied: SteamFrameCct | null = null;
    let sentTo: string | null = null;
    while (this.pending !== null) {
      const target = this.target.value;
      if (target.kind !== 'frame' || !target.cct || !target.pairingId) break;
      const value = this.pending;
      this.pending = null;
      sentTo = target.pairingId;
      applied = await invoke<SteamFrameCct>('steam_frame_set_cct', {
        pairingId: sentTo,
        kelvin: value,
      }).catch((e) => {
        warn(`[CCTControl] Could not set the Steam Frame color temperature: ${e}`);
        return null;
      });
    }
    this.sending = false;
    this.pending = null;

    // show what the active headset holds now; a reply from a Frame that stopped being active is stale
    const target = this.target.value;
    if (target.kind !== 'frame' || !target.cct) return;
    const replyApplies = applied?.kelvin != null && sentTo === target.pairingId;
    this.adopt(replyApplies ? (applied as FrameCct) : target.cct);
  }
}
