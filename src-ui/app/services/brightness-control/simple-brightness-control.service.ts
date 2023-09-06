import { Injectable } from '@angular/core';
import { BehaviorSubject, distinctUntilChanged, filter, map, Observable, skip, tap } from 'rxjs';
import { info } from 'tauri-plugin-log-api';
import { CancellableTask } from '../../utils/cancellable-task';
import { createBrightnessTransitionTask } from './brightness-transition';
import { AutomationConfigService } from '../automation-config.service';
import { DisplayBrightnessControlService } from './display-brightness-control.service';
import { ImageBrightnessControlService } from './image-brightness-control.service';
import { lerp } from '../../utils/number-utils';
import { clamp } from 'lodash';

@Injectable({
  providedIn: 'root',
})
export class SimpleBrightnessControlService {
  private _brightness: BehaviorSubject<number> = new BehaviorSubject<number>(100);
  private _activeTransition?: CancellableTask;
  private advancedMode = false;
  private displayBrightnessDriverAvailable = false;

  public get activeTransition() {
    return this._activeTransition;
  }

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
    // Set brightness when switching to simple mode
    this.automationConfigService.configs
      .pipe(
        skip(1),
        map((configs) => configs.BRIGHTNESS_CONTROL_ADVANCED_MODE),
        tap((config) => (this.advancedMode = config.enabled)),
        filter((config) => !config.enabled)
      )
      .subscribe(async () => {
        await this.setBrightness(this.brightness, 'INDIRECT');
      });
    // Set brightness when the display brightness driver availability changes
    this.displayBrightnessControl.driverIsAvailable
      .pipe(
        distinctUntilChanged(),
        tap((available) => (this.displayBrightnessDriverAvailable = available)),
        filter(() => !this.advancedMode)
      )
      .subscribe(() => {
        this.setBrightness(this.brightness, 'INDIRECT');
      });
  }

  transitionBrightness(
    percentage: number,
    duration: number,
    reason: 'DIRECT' | 'INDIRECT'
  ): CancellableTask {
    this._activeTransition?.cancel();
    this._activeTransition = createBrightnessTransitionTask(
      'SIMPLE',
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
    info(`[BrightnessControl] Starting brightness transition (${reason})`);
    this._activeTransition.start();
    return this._activeTransition;
  }

  cancelActiveTransition() {
    this._activeTransition?.cancel();
    this._activeTransition = undefined;
  }

  async setBrightness(percentage: number, reason: 'DIRECT' | 'INDIRECT') {
    percentage = clamp(percentage, 0, 100);
    if (reason === 'DIRECT') this.cancelActiveTransition();
    if (percentage == this.brightness) return;
    this._brightness.next(percentage);
    switch (reason) {
      case 'DIRECT':
        await info(`[BrightnessControl] Set brightness to ${percentage}% (${reason})`);
        break;
      case 'INDIRECT':
        // Logs are made by whatever triggered the brightness change.
        break;
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
    this.imageBrightnessControl.cancelActiveTransition();
    await this.imageBrightnessControl.setBrightness(imageBrightness, 'INDIRECT');
    if (this.displayBrightnessDriverAvailable) {
      this.displayBrightnessControl.cancelActiveTransition();
      await this.displayBrightnessControl.setBrightness(displayBrightness, 'INDIRECT');
    }
  }
}
