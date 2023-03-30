import { Injectable } from '@angular/core';
import { AutomationConfigService } from '../automation-config.service';
import { SleepService } from '../sleep.service';
import { distinctUntilChanged, firstValueFrom, skip } from 'rxjs';
import { BrightnessControlService } from './brightness-control.service';
import { CancellableTask } from '../../utils/cancellable-task';
import { EventLogService } from '../event-log.service';
import { EventLogBrightnessChanged } from '../../models/event-log-entry';

@Injectable({
  providedIn: 'root',
})
export class BrightnessControlAutomationService {
  private lastActivatedTransition?: { task: CancellableTask; sleepMode: boolean };

  constructor(
    private automationConfigService: AutomationConfigService,
    private sleepService: SleepService,
    private brightnessControl: BrightnessControlService,
    private eventLog: EventLogService
  ) {}

  async init() {
    this.sleepService.mode
      .pipe(skip(1), distinctUntilChanged())
      .subscribe((sleepMode) => this.onSleepModeChange(sleepMode));
  }

  public get isSleepEnableTransitionActive() {
    const activeTransition = this.brightnessControl.activeTransition;
    return (
      this.lastActivatedTransition?.sleepMode === true &&
      !!activeTransition &&
      activeTransition === this.lastActivatedTransition?.task
    );
  }

  public get isSleepDisableTransitionActive() {
    const activeTransition = this.brightnessControl.activeTransition;
    return (
      this.lastActivatedTransition?.sleepMode === false &&
      !!activeTransition &&
      activeTransition === this.lastActivatedTransition?.task
    );
  }

  private async onSleepModeChange(sleepMode: boolean) {
    const config = await firstValueFrom(this.automationConfigService.configs).then((c) =>
      sleepMode
        ? c.DISPLAY_BRIGHTNESS_ON_SLEEP_MODE_ENABLE
        : c.DISPLAY_BRIGHTNESS_ON_SLEEP_MODE_DISABLE
    );
    if (!config.enabled) return;
    this.brightnessControl.cancelActiveTransition();
    if (config.transition) {
      const task = this.brightnessControl.transitionBrightness(
        config.brightness,
        config.transitionTime,
        'BRIGHTNESS_AUTOMATION'
      );
      this.lastActivatedTransition = {
        task,
        sleepMode,
      };
    } else {
      await this.brightnessControl.setBrightness(config.brightness, 'BRIGHTNESS_AUTOMATION');
    }
    this.eventLog.logEvent({
      type: 'brightnessChanged',
      reason: sleepMode ? 'SLEEP_MODE_ENABLED' : 'SLEEP_MODE_DISABLED',
      value: config.brightness,
      transition: config.transition,
      transitionTime: config.transitionTime,
    } as EventLogBrightnessChanged);
  }
}
