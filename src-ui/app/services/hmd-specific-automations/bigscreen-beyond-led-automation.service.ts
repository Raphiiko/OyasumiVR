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
import { AutomationConfigService } from '../automation-config.service';
import {
  AUTOMATION_CONFIGS_DEFAULT,
  BigscreenBeyondRgbControlAutomationsConfig,
} from '../../models/automations';

import { SleepService } from '../sleep.service';
import { SleepPreparationService } from '../sleep-preparation.service';
import { CancellableTask } from '../../utils/cancellable-task';
import { clamp, smoothLerp } from '../../utils/number-utils';
import { EventLogService } from '../event-log.service';
import { EventLogBSBLedChanged } from '../../models/event-log-entry';

@Injectable({
  providedIn: 'root',
})
export class BigscreenBeyondLedAutomationService {
  private connected = new BehaviorSubject(false);
  private config: BigscreenBeyondRgbControlAutomationsConfig = structuredClone(
    AUTOMATION_CONFIGS_DEFAULT.BIGSCREEN_BEYOND_RGB_CONTROL
  );
  private transitionTask?: CancellableTask;
  private lastSetColor: [number, number, number] = [0, 0, 0];
  private _lastSetColorExt = new BehaviorSubject<[number, number, number]>([0, 0, 0]);
  public lastSetColorExt = this._lastSetColorExt.asObservable();

  constructor(
    private automationConfigService: AutomationConfigService,
    private sleepService: SleepService,
    private sleepPreparation: SleepPreparationService,
    private eventLog: EventLogService
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
    if (!this.connected.value) return;
    if (sleepMode && this.config.onSleepEnable) {
      this.eventLog.logEvent({
        type: 'bsbLedChanged',
        reason: 'SLEEP_MODE_ENABLED',
        color: this.config.onSleepEnableRgb,
      } as EventLogBSBLedChanged);
      await this.setLedColor(this.config.onSleepEnableRgb);
    } else if (!sleepMode && this.config.onSleepDisable) {
      this.eventLog.logEvent({
        type: 'bsbLedChanged',
        reason: 'SLEEP_MODE_DISABLED',
        color: this.config.onSleepDisableRgb,
      } as EventLogBSBLedChanged);
      await this.setLedColor(this.config.onSleepDisableRgb);
    }
  }

  private async onSleepPreparation() {
    if (!this.connected.value) return;
    if (this.config.onSleepPreparation) {
      await this.setLedColor(this.config.onSleepPreparationRgb);
      this.eventLog.logEvent({
        type: 'bsbLedChanged',
        reason: 'SLEEP_PREPARATION',
        color: this.config.onSleepPreparationRgb,
      } as EventLogBSBLedChanged);
    }
  }

  public async setLedColor(targetColor: [number, number, number], transition = true) {
    this.transitionTask?.cancel();
    if (!this.connected.value) return;
    this._lastSetColorExt.next(targetColor);
    if (transition) {
      this.transitionTask = new CancellableTask(async (task: CancellableTask) => {
        const duration = 1000;
        const frequency = 30;
        const startTime = Date.now();
        const startColor = [...this.lastSetColor];
        while (Date.now() <= startTime + duration && this.connected.value) {
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
          if (this.connected.value) {
            invoke('bigscreen_beyond_set_led_color', {
              r: color[0],
              g: color[1],
              b: color[2],
            });
            this.lastSetColor = [...color];
          }
        }
        // Set the final target color
        if (this.connected.value) {
          invoke('bigscreen_beyond_set_led_color', {
            r: targetColor[0],
            g: targetColor[1],
            b: targetColor[2],
          });
          this.lastSetColor = [...targetColor];
          this._lastSetColorExt.next(this.lastSetColor);
        }
      });
      await this.transitionTask.start();
    } else {
      invoke('bigscreen_beyond_set_led_color', {
        r: targetColor[0],
        g: targetColor[1],
        b: targetColor[2],
      });
      this.lastSetColor = [...targetColor];
      this._lastSetColorExt.next(this.lastSetColor);
    }
  }
}
