import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { info } from 'tauri-plugin-log-api';
import { CancellableTask } from '../../utils/cancellable-task';
import { BrightnessTransitionTask } from './brightness-transition';
import { invoke } from '@tauri-apps/api';
import {
  SET_BRIGHTNESS_OR_CCT_OPTIONS_DEFAULTS,
  SetBrightnessOrCCTOptions,
} from './brightness-control-models';
import { listen } from '@tauri-apps/api/event';

export const DEFAULT_SOFTWARE_BRIGHTNESS_GAMMA = 0.55;

@Injectable({
  providedIn: 'root',
})
export class SoftwareBrightnessControlService {
  private _brightness: BehaviorSubject<number> = new BehaviorSubject<number>(100);
  private _activeTransition = new BehaviorSubject<BrightnessTransitionTask | undefined>(undefined);
  public readonly activeTransition = this._activeTransition.asObservable();
  private _perceivedBrightnessAdjustmentGamma: number | null = DEFAULT_SOFTWARE_BRIGHTNESS_GAMMA;

  get brightness(): number {
    return this._brightness.value;
  }

  public readonly brightnessStream: Observable<number> = this._brightness.asObservable();

  constructor() {}

  public set perceivedBrightnessAdjustmentGamma(value: number | null) {
    this._perceivedBrightnessAdjustmentGamma = value;
    this.setSoftwareBrightness(this.brightness);
  }

  public get perceivedBrightnessAdjustmentGamma() {
    return this._perceivedBrightnessAdjustmentGamma;
  }

  async init() {
    await this.setSoftwareBrightness(this.brightness);
    await listen<number>('setSoftwareBrightness', async (event) => {
      await this.setBrightness(event.payload, { cancelActiveTransition: true });
    });
  }

  private async setSoftwareBrightness(brightness: number) {
    await invoke('openvr_set_image_brightness', {
      brightness: brightness / 100,
      perceivedBrightnessAdjustmentGamma: this._perceivedBrightnessAdjustmentGamma ?? null,
    });
  }

  transitionBrightness(
    percentage: number,
    duration: number,
    options: Partial<SetBrightnessOrCCTOptions> = SET_BRIGHTNESS_OR_CCT_OPTIONS_DEFAULTS
  ): CancellableTask {
    const opt = { ...SET_BRIGHTNESS_OR_CCT_OPTIONS_DEFAULTS, ...(options ?? {}) };
    if (this._brightness.value === percentage) {
      const task = new CancellableTask();
      task.start();
      return task;
    }
    this._activeTransition.value?.cancel();
    const transition = new BrightnessTransitionTask(
      'SOFTWARE',
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
      info(
        `[BrightnessControl] Starting software brightness transition (Reason: ${opt.logReason})`
      );
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
    options: Partial<SetBrightnessOrCCTOptions> = SET_BRIGHTNESS_OR_CCT_OPTIONS_DEFAULTS
  ) {
    const opt = { ...SET_BRIGHTNESS_OR_CCT_OPTIONS_DEFAULTS, ...(options ?? {}) };
    if (opt.cancelActiveTransition) this.cancelActiveTransition();
    if (percentage == this.brightness) return;
    this._brightness.next(percentage);
    await this.setSoftwareBrightness(percentage);
    if (opt.logReason) {
      await info(
        `[BrightnessControl] Set software brightness to ${percentage}% (Reason: ${opt.logReason})`
      );
    }
  }
}
