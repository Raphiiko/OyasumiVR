import { Injectable } from '@angular/core';
import {
  BehaviorSubject,
  distinctUntilChanged,
  filter,
  firstValueFrom,
  map,
  Observable,
  skip,
  tap,
} from 'rxjs';
import { info } from 'tauri-plugin-log-api';
import { CancellableTask } from '../../utils/cancellable-task';
import { BrightnessTransitionTask } from './brightness-transition';
import { AutomationConfigService } from '../automation-config.service';
import { HardwareBrightnessControlService } from './hardware-brightness-control.service';
import { SoftwareBrightnessControlService } from './software-brightness-control.service';
import { lerp } from '../../utils/number-utils';
import { clamp } from 'lodash';
import { SET_BRIGHTNESS_OPTIONS_DEFAULTS, SetBrightnessOptions } from './brightness-control-models';
import { listen } from '@tauri-apps/api/event';

@Injectable({
  providedIn: 'root',
})
export class SimpleBrightnessControlService {
  private _advancedMode = new BehaviorSubject(false);
  private _brightness: BehaviorSubject<number> = new BehaviorSubject<number>(100);
  private _activeTransition = new BehaviorSubject<BrightnessTransitionTask | undefined>(undefined);
  public readonly activeTransition = this._activeTransition.asObservable();
  private hardwareBrightnessDriverAvailable = false;
  public readonly advancedMode = this._advancedMode.asObservable();

  get brightness(): number {
    return this._brightness.value;
  }

  public readonly brightnessStream: Observable<number> = this._brightness.asObservable();

  constructor(
    private automationConfigService: AutomationConfigService,
    private hardwareBrightnessControl: HardwareBrightnessControlService,
    private softwareBrightnessControl: SoftwareBrightnessControlService
  ) {}

  async init() {
    await listen<number>('setSimpleBrightness', async (event) => {
      await this.setBrightness(event.payload, { cancelActiveTransition: true });
    });
    // Set brightness when switching to simple mode
    this.automationConfigService.configs
      .pipe(
        map((configs) => configs.BRIGHTNESS_CONTROL_ADVANCED_MODE),
        tap((config) => this._advancedMode.next(config.enabled)),
        skip(1)
      )
      .subscribe(async (advancedMode) => {
        this.cancelActiveTransition();
        this.hardwareBrightnessControl.cancelActiveTransition();
        this.softwareBrightnessControl.cancelActiveTransition();
        if (!advancedMode) {
          await this.setBrightness(this.brightness, {
            cancelActiveTransition: true,
            logReason: undefined,
          });
        }
      });
    // Set brightness when the hardware brightness driver availability changes
    this.hardwareBrightnessControl.driverIsAvailable
      .pipe(
        skip(1),
        distinctUntilChanged(),
        tap((available) => (this.hardwareBrightnessDriverAvailable = available)),
        filter(() => !this._advancedMode.value)
      )
      .subscribe(() => {
        this.setBrightness(this.brightness, {
          cancelActiveTransition: true,
          logReason: undefined,
        });
      });
  }

  transitionBrightness(
    percentage: number,
    duration: number,
    options: Partial<SetBrightnessOptions> = SET_BRIGHTNESS_OPTIONS_DEFAULTS
  ): CancellableTask {
    const opt = { ...SET_BRIGHTNESS_OPTIONS_DEFAULTS, ...(options ?? {}) };
    if (this._brightness.value === percentage) {
      const task = new CancellableTask();
      task.start();
      return task;
    }
    this._activeTransition.value?.cancel();
    const transition = new BrightnessTransitionTask(
      'SIMPLE',
      this.setBrightness.bind(this),
      async () => this.brightness,
      async () => [0, 100],
      percentage,
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
      info(`[BrightnessControl] Starting brightness transition (Reason: ${opt.logReason})`);
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

  async setBrightness(
    percentage: number,
    options: Partial<SetBrightnessOptions> = SET_BRIGHTNESS_OPTIONS_DEFAULTS
  ) {
    const opt = { ...SET_BRIGHTNESS_OPTIONS_DEFAULTS, ...(options ?? {}) };
    percentage = clamp(percentage, 0, 100);
    if (opt.cancelActiveTransition) this.cancelActiveTransition();
    this._brightness.next(percentage);
    if (opt.logReason) {
      await info(`[BrightnessControl] Set brightness to ${percentage}% (Reason: ${opt.logReason})`);
    }
    // Calculate brightnesses
    let softwareBrightness = percentage;
    let hardwareBrightness = 100;
    // If the hardware brightness driver is available, intelligently switch between the two brightnesses
    let dbgHwBrightnessRange;
    if (this.hardwareBrightnessDriverAvailable) {
      const softwareBrightnessRange = [0, 0];
      const hardwareBrightnessRange = await firstValueFrom(
        this.hardwareBrightnessControl.brightnessBounds
      );
      dbgHwBrightnessRange = [...hardwareBrightnessRange];
      if (hardwareBrightnessRange[0] > 0) {
        softwareBrightnessRange[1] = hardwareBrightnessRange[0];
      }
      if (percentage >= 0 && percentage < softwareBrightnessRange[1]) {
        hardwareBrightness = hardwareBrightnessRange[0];
        softwareBrightness = lerp(0, 100, percentage / softwareBrightnessRange[1]);
      } else {
        softwareBrightness = 100;
        hardwareBrightness = lerp(
          hardwareBrightnessRange[0],
          hardwareBrightnessRange[1],
          (percentage - softwareBrightnessRange[1]) / (100 - softwareBrightnessRange[1])
        );
      }
    }
    // Set brightnesses
    await this.softwareBrightnessControl.setBrightness(softwareBrightness, {
      cancelActiveTransition: true,
      logReason: null,
    });
    if (this.hardwareBrightnessDriverAvailable) {
      await this.hardwareBrightnessControl.setBrightness(hardwareBrightness, {
        cancelActiveTransition: true,
        logReason: null,
      });
    }
    const dbg = {
      softwareBrightness,
      hardwareBrightness,
      hardwareBrightnessDriverAvailable: this.hardwareBrightnessDriverAvailable,
      dbgHwBrightnessRange,
    };
    info('SIMPLE_BRIGHTNESS_DBG: ' + JSON.stringify(dbg));
  }
}
