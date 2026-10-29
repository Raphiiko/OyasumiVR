import { Injectable } from '@angular/core';
import {
  BehaviorSubject,
  debounceTime,
  distinctUntilChanged,
  filter,
  firstValueFrom,
  interval,
  map,
  skip,
  startWith,
  switchMap,
} from 'rxjs';
import { commands, events } from '../../bindings';
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
import { warn } from '@tauri-apps/plugin-log';

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
    events.bigscreenBeyondConnectedEvent.listen((event) => {
      this.connected.next(event.payload);
    });
    interval(10000)
      .pipe(
        startWith(0),
        switchMap(() =>
          commands.bigscreenBeyondIsConnected().then((connected) => {
            this.connected.next(connected);
          })
        )
      )
      .subscribe();
    // Handle LED color when the HMD is being connected
    this.connected
      .pipe(distinctUntilChanged(), debounceTime(500), filter(Boolean))
      .subscribe(() => this.onHmdConnect());
    // Setup the automations
    this.sleepService.mode
      .pipe(distinctUntilChanged(), skip(1))
      .subscribe((sleepMode) => this.onSleepModeChange(sleepMode));
    this.sleepPreparation.onSleepPreparation.subscribe(() => this.onSleepPreparation());
  }

  private async onHmdConnect() {
    const sleepMode = await firstValueFrom(this.sleepService.mode);
    if (sleepMode && this.config.onSleepEnable) {
      await this.setLedColor(this.config.onSleepEnableRgb, false);
    } else if (!sleepMode && this.config.onSleepDisable) {
      await this.setLedColor(this.config.onSleepDisableRgb, false);
    }
  }

  private async onSleepModeChange(sleepMode: boolean) {
    if (!this.connected.value) return;
    if (sleepMode && this.config.onSleepEnable) {
      await this.setLedColorAndLog(this.config.onSleepEnableRgb, 'SLEEP_MODE_ENABLED');
    } else if (!sleepMode && this.config.onSleepDisable) {
      await this.setLedColorAndLog(this.config.onSleepDisableRgb, 'SLEEP_MODE_DISABLED');
    }
  }

  private async onSleepPreparation() {
    if (!this.connected.value) return;
    if (this.config.onSleepPreparation) {
      await this.setLedColorAndLog(this.config.onSleepPreparationRgb, 'SLEEP_PREPARATION');
    }
  }

  private async setLedColorAndLog(
    color: [number, number, number],
    reason: EventLogBSBLedChanged['reason']
  ) {
    if (await this.setLedColor(color, false))
      this.eventLog.logEvent({ type: 'bsbLedChanged', reason, color });
  }

  /** Resolves false when the headset rejected the colour; a transition always resolves true. */
  public async setLedColor(
    targetColor: [number, number, number],
    transition = true
  ): Promise<boolean> {
    this.transitionTask?.cancel();
    if (!this.connected.value) return false;
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
            commands.bigscreenBeyondSetLedColor(color[0], color[1], color[2]);
            this.lastSetColor = [...color];
          }
        }
        // Set the final target color
        if (this.connected.value) {
          commands.bigscreenBeyondSetLedColor(targetColor[0], targetColor[1], targetColor[2]);
          this.lastSetColor = [...targetColor];
          this._lastSetColorExt.next(this.lastSetColor);
        }
      });
      await this.transitionTask.start();
      return true;
    }
    const applied = await commands
      .bigscreenBeyondSetLedColor(targetColor[0], targetColor[1], targetColor[2])
      .then(
        () => true,
        (e) => {
          warn(`[BigscreenBeyondLedAutomation] Could not set the LED colour: ${e}`);
          return false;
        }
      );
    this.lastSetColor = [...targetColor];
    this._lastSetColorExt.next(this.lastSetColor);
    return applied;
  }
}
