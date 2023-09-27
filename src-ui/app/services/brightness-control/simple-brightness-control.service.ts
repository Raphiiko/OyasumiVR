import { Injectable } from '@angular/core';
import { BehaviorSubject, distinctUntilChanged, filter, map, Observable, skip, tap } from 'rxjs';
import { info } from 'tauri-plugin-log-api';
import { CancellableTask } from '../../utils/cancellable-task';
import { BrightnessTransitionTask } from './brightness-transition';
import { AutomationConfigService } from '../automation-config.service';
import { DisplayBrightnessControlService } from './display-brightness-control.service';
import { ImageBrightnessControlService } from './image-brightness-control.service';
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
  private displayBrightnessDriverAvailable = false;
  public readonly advancedMode = this._advancedMode.asObservable();

  get brightness(): number {
    return this._brightness.value;
  }

  public readonly brightnessStream: Observable<number> = this._brightness.asObservable();

  constructor(
    private automationConfigService: AutomationConfigService,
    private displayBrightnessControl: DisplayBrightnessControlService,
    private imageBrightnessControl: ImageBrightnessControlService
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
        this.displayBrightnessControl.cancelActiveTransition();
        this.imageBrightnessControl.cancelActiveTransition();
        if (!advancedMode) {
          await this.setBrightness(this.brightness, {
            cancelActiveTransition: true,
            logReason: undefined,
          });
        }
      });
    // Set brightness when the display brightness driver availability changes
    this.displayBrightnessControl.driverIsAvailable
      .pipe(
        distinctUntilChanged(),
        tap((available) => (this.displayBrightnessDriverAvailable = available)),
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
    if (percentage == this.brightness) return;
    this._brightness.next(percentage);
    if (opt.logReason) {
      await info(`[BrightnessControl] Set brightness to ${percentage}% (Reason: ${opt.logReason})`);
    }
    // Calculate brightnesses
    let imageBrightness = percentage;
    let displayBrightness = 100;
    // If the display brightness driver is available, intelligently switch between the two brightnesses
    if (this.displayBrightnessDriverAvailable) {
      const imageBrightnessRange = [0, 0];
      const displayBrightnessRange = await this.displayBrightnessControl.getBrightnessBounds();
      if (displayBrightnessRange[0] > 0) {
        imageBrightnessRange[1] = displayBrightnessRange[0];
      }
      if (percentage >= 0 && percentage < imageBrightnessRange[1]) {
        displayBrightness = displayBrightnessRange[0];
        imageBrightness = lerp(0, 100, percentage / imageBrightnessRange[1]);
      } else {
        imageBrightness = 100;
        displayBrightness = lerp(
          displayBrightnessRange[0],
          displayBrightnessRange[1],
          (percentage - imageBrightnessRange[1]) / (100 - imageBrightnessRange[1])
        );
      }
    }
    // Set brightnesses
    await this.imageBrightnessControl.setBrightness(imageBrightness, {
      cancelActiveTransition: true,
      logReason: null,
    });
    if (this.displayBrightnessDriverAvailable) {
      await this.displayBrightnessControl.setBrightness(displayBrightness, {
        cancelActiveTransition: true,
        logReason: null,
      });
    }
  }
}
