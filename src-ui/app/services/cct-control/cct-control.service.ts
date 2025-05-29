import { Injectable } from '@angular/core';
import {
  BehaviorSubject,
  combineLatest,
  debounceTime,
  distinctUntilChanged,
  Observable,
} from 'rxjs';
import { CCTTransitionTask } from './cct-transition';
import { listen } from '@tauri-apps/api/event';
import {
  SET_BRIGHTNESS_OR_CCT_OPTIONS_DEFAULTS,
  SetBrightnessOrCCTOptions,
} from '../brightness-control/brightness-control-models';
import { CancellableTask } from '../../utils/cancellable-task';
import { info } from '@tauri-apps/plugin-log';
import { invoke } from '@tauri-apps/api/core';
import { getCSSColorForCCT } from 'src-shared-ts/src/cct-utils';
import { OpenVRService } from '../openvr.service';
import { clamp } from '../../utils/number-utils';
import { AppSettingsService } from '../app-settings.service';

@Injectable({
  providedIn: 'root',
})
export class CCTControlService {
  private _cct: BehaviorSubject<number> = new BehaviorSubject<number>(6600);
  private _activeTransition = new BehaviorSubject<CCTTransitionTask | undefined>(undefined);
  private hardwareReady = false;
  public readonly activeTransition = this._activeTransition.asObservable();
  public cctCSSColor: string = 'white';
  private cctControlEnabled: boolean = false;
  private initialized = false;

  get cct(): number {
    return this._cct.value;
  }

  public readonly cctStream: Observable<number> = this._cct.asObservable();

  constructor(
    private openvr: OpenVRService,
    private appSettingsService: AppSettingsService
  ) {}

  async init() {
    this.appSettingsService.settings.subscribe((settings) => {
      this.cctControlEnabled = settings.cctControlEnabled;
      if (!this.initialized) {
        this.setCCT(this.cct);
        combineLatest([this.openvr.status, this.openvr.devices])
          .pipe(debounceTime(100))
          .subscribe(([status, devices]) => {
            const ready =
              status === 'INITIALIZED' &&
              !!devices.length &&
              devices.find((d) => d.index === 0)?.class === 'HMD';
            if (ready && !this.hardwareReady) {
              this.hardwareReady = ready;
              this.setCCT(this.cct, SET_BRIGHTNESS_OR_CCT_OPTIONS_DEFAULTS, true);
            }
            this.hardwareReady = ready;
          });
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
    if (cct === this.cct && !force) return;
    this._cct.next(cct);
    if (this.hardwareReady) invoke('openvr_set_analog_color_temp', { temperature: cct });
    if (opt.logReason) {
      await info(`[CCTControl] Set CCT to ${cct}K (Reason: ${opt.logReason})`);
    }
  }
}
