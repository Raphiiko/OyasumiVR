import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { info } from 'tauri-plugin-log-api';
import { CancellableTask } from '../../utils/cancellable-task';
import { createBrightnessTransitionTask } from './brightness-transition';
import { invoke } from '@tauri-apps/api';

@Injectable({
  providedIn: 'root',
})
export class ImageBrightnessControlService {
  private _brightness: BehaviorSubject<number> = new BehaviorSubject<number>(100);
  private _activeTransition?: CancellableTask;

  public get activeTransition() {
    return this._activeTransition;
  }

  get brightness(): number {
    return this._brightness.value;
  }

  public readonly brightnessStream: Observable<number> = this._brightness.asObservable();

  constructor() {}

  async init() {
    await invoke('openvr_set_image_brightness', { brightness: this.brightness / 100 });
  }

  transitionBrightness(
    percentage: number,
    duration: number,
    reason: 'DIRECT' | 'BRIGHTNESS_AUTOMATION'
  ): CancellableTask {
    this._activeTransition?.cancel();
    this._activeTransition = createBrightnessTransitionTask(
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

  async setBrightness(percentage: number, reason: 'DIRECT' | 'BRIGHTNESS_AUTOMATION') {
    if (reason !== 'BRIGHTNESS_AUTOMATION') this.cancelActiveTransition();
    if (percentage == this.brightness) return;
    this._brightness.next(percentage);
    await invoke('openvr_set_image_brightness', { brightness: percentage / 100 });
    switch (reason) {
      case 'DIRECT':
        await info(`[BrightnessControl] Set image brightness to ${percentage}% (${reason})`);
        break;
      case 'BRIGHTNESS_AUTOMATION':
        // Would log too often. Automations log by themselves instead.
        break;
    }
  }
}
