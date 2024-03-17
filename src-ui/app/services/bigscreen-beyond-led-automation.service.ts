import { Injectable } from '@angular/core';
import {
  BehaviorSubject,
  distinctUntilChanged,
  filter,
  firstValueFrom,
  interval,
  map,
  skip,
  startWith,
  switchMap,
} from 'rxjs';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api';
import { AutomationConfigService } from './automation-config.service';
import {
  AUTOMATION_CONFIGS_DEFAULT,
  BigscreenBeyondRgbControlAutomationsConfig,
} from '../models/automations';
import { cloneDeep } from 'lodash';
import { SleepService } from './sleep.service';
import { SleepPreparationService } from './sleep-preparation.service';
import { CancellableTask } from '../utils/cancellable-task';
import { clamp, smoothLerp } from '../utils/number-utils';

@Injectable({
  providedIn: 'root',
})
export class BigscreenBeyondLedAutomationService {
  private connected = new BehaviorSubject(false);
  private config: BigscreenBeyondRgbControlAutomationsConfig = cloneDeep(
    AUTOMATION_CONFIGS_DEFAULT.BIGSCREEN_BEYOND_RGB_CONTROL
  );
  private transitionTask?: CancellableTask;
  private lastSetColor: [number, number, number] = [0, 0, 0];

  constructor(
    private automationConfigService: AutomationConfigService,
    private sleepService: SleepService,
    private sleepPreparation: SleepPreparationService
  ) {}

  async init() {
    // Listen for config changes
    this.automationConfigService.configs
      .pipe(map((c) => c.BIGSCREEN_BEYOND_RGB_CONTROL))
      .subscribe((config) => (this.config = config));
    // Listen for the connection state of the Bigscreen Beyond
    listen<boolean>('BIGSCREEN_BEYOND_CONNECTED', (event) => {
      this.connected.next(event.payload);
    });
    interval(10000)
      .pipe(
        startWith(0),
        switchMap(() =>
          invoke<boolean>('bigscreen_beyond_is_connected').then((connected) => {
            this.connected.next(connected);
          })
        )
      )
      .subscribe();
    // Setup the automations
    this.sleepService.mode
      .pipe(distinctUntilChanged(), skip(1))
      .subscribe((sleepMode) => this.onSleepModeChange(sleepMode));
    this.sleepPreparation.onSleepPreparation.subscribe(() => this.onSleepPreparation());
    this.connected.pipe(filter(Boolean), distinctUntilChanged()).subscribe(async () => {
      await this.onSleepModeChange(await firstValueFrom(this.sleepService.mode));
    });
  }

  private async onSleepModeChange(sleepMode: boolean) {
    if (sleepMode && this.config.onSleepEnable) {
      await this.setLedColor(this.config.onSleepEnableRgb);
    } else if (!sleepMode && this.config.onSleepDisable) {
      await this.setLedColor(this.config.onSleepDisableRgb);
    }
  }

  private async onSleepPreparation() {
    if (this.config.onSleepPreparation) {
      await this.setLedColor(this.config.onSleepPreparationRgb);
    }
  }

  private async setLedColor(targetColor: [number, number, number]) {
    this.transitionTask?.cancel();
    if (!this.connected.value) return;
    this.transitionTask = new CancellableTask(async (task: CancellableTask) => {
      const duration = 1000;
      const frequency = 30;
      const startTime = Date.now();
      const startColor = [...this.lastSetColor];
      while (Date.now() <= startTime + duration) {
        // Sleep to match the frequency
        await new Promise((resolve) => setTimeout(resolve, 1000 / frequency));
        // Stop if the transition was cancelled
        if (task.isCancelled()) return;
        // Calculate the required brightness
        const timeExpired = Date.now() - startTime;
        const progress = clamp(timeExpired / duration, 0, 1);
        const color: [number, number, number] = [
          Math.round(smoothLerp(startColor[0], targetColor[0], progress)),
          Math.round(smoothLerp(startColor[1], targetColor[1], progress)),
          Math.round(smoothLerp(startColor[2], targetColor[2], progress)),
        ];
        // Set the intermediary color
        invoke('bigscreen_beyond_set_led_color', {
          r: color[0],
          g: color[1],
          b: color[2],
        });
        this.lastSetColor = [...color];
      }
      // Set the final target color
      invoke('bigscreen_beyond_set_led_color', {
        r: targetColor[0],
        g: targetColor[1],
        b: targetColor[2],
      });
      this.lastSetColor = [...targetColor];
    });
    await this.transitionTask.start();
  }
}
