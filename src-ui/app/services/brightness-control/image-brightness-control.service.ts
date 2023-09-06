import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { info } from 'tauri-plugin-log-api';
import { CancellableTask } from '../../utils/cancellable-task';
import { createBrightnessTransitionTask } from './brightness-transition';
import { invoke } from '@tauri-apps/api';

export const DEFAULT_IMAGE_BRIGHTNESS_GAMMA = 0.55;

@Injectable({
  providedIn: 'root',
})
export class ImageBrightnessControlService {
  private _brightness: BehaviorSubject<number> = new BehaviorSubject<number>(100);
  private _activeTransition?: CancellableTask;
  private _perceivedBrightnessAdjustmentGamma: number | null = DEFAULT_IMAGE_BRIGHTNESS_GAMMA;

  public get activeTransition() {
    return this._activeTransition;
  }

  get brightness(): number {
    return this._brightness.value;
  }

  public readonly brightnessStream: Observable<number> = this._brightness.asObservable();

  constructor() {}

  public set perceivedBrightnessAdjustmentGamma(value: number | null) {
    this._perceivedBrightnessAdjustmentGamma = value;
    this.setImageBrightness(this.brightness);
  }

  public get perceivedBrightnessAdjustmentGamma() {
    return this._perceivedBrightnessAdjustmentGamma;
  }

  async init() {
    await this.setImageBrightness(this.brightness);
  }

  private async setImageBrightness(brightness: number) {
    await invoke('openvr_set_image_brightness', {
      brightness: brightness / 100,
      perceivedBrightnessAdjustmentGamma: this._perceivedBrightnessAdjustmentGamma ?? null,
    });
  }

  transitionBrightness(
    percentage: number,
    duration: number,
    reason: 'DIRECT' | 'INDIRECT'
  ): CancellableTask {
    this._activeTransition?.cancel();
    this._activeTransition = createBrightnessTransitionTask(
      'IMAGE',
      this.setBrightness.bind(this),
      async () => this.brightness,
      async () => [0, 100],
      percentage,
      duration
    );
    this._activeTransition.onComplete.subscribe(() => {
      if (this._activeTransition?.isComplete()) this._activeTransition = undefined;
    });
    this._activeTransition.onError.subscribe(() => {
      if (this._activeTransition?.isError()) this._activeTransition = undefined;
    });
    info(`[BrightnessControl] Starting image brightness transition (${reason})`);
    this._activeTransition.start();
    return this._activeTransition;
  }

  cancelActiveTransition() {
    this._activeTransition?.cancel();
    this._activeTransition = undefined;
  }

  async setBrightness(percentage: number, reason: 'DIRECT' | 'INDIRECT') {
    if (reason === 'DIRECT') this.cancelActiveTransition();
    if (percentage == this.brightness) return;
    this._brightness.next(percentage);
    await this.setImageBrightness(percentage);
    switch (reason) {
      case 'DIRECT':
        await info(`[BrightnessControl] Set image brightness to ${percentage}% (${reason})`);
        break;
      case 'INDIRECT':
        // Logs are made by whatever triggered the brightness change.
        break;
    }
  }
}
