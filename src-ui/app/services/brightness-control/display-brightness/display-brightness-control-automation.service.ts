import { Injectable } from '@angular/core';
import { AutomationConfigService } from '../../automation-config.service';
import { SleepService } from '../../sleep.service';
import { delay, distinctUntilChanged, firstValueFrom, of, skip, switchMap, take } from 'rxjs';
import { DisplayBrightnessControlService } from './display-brightness-control.service';
import { CancellableTask } from '../../../utils/cancellable-task';
import { EventLogService } from '../../event-log.service';
import { EventLogDisplayBrightnessChanged } from '../../../models/event-log-entry';

@Injectable({
  providedIn: 'root',
})
export class DisplayBrightnessControlAutomationService {
  private lastActivatedTransition?: { task: CancellableTask; sleepMode: boolean };

  constructor(
    private automationConfigService: AutomationConfigService,
    private sleepService: SleepService,
    private brightnessControl: DisplayBrightnessControlService,
    private eventLog: EventLogService
  ) {}

  async init() {
    this.sleepService.mode
      .pipe(skip(1), distinctUntilChanged())
      .subscribe((sleepMode) => this.onSleepModeChange(sleepMode));
    // Apply current mode at startup
    of(null)
      .pipe(
        delay(2000),
        switchMap(() => this.sleepService.mode),
        take(1)
      )
      .subscribe((sleepMode) => this.onSleepModeChange(sleepMode, true));
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

  private async onSleepModeChange(sleepMode: boolean, forceInstant = false) {
    const config = await firstValueFrom(this.automationConfigService.configs).then((c) =>
      sleepMode
        ? c.DISPLAY_BRIGHTNESS_ON_SLEEP_MODE_ENABLE
        : c.DISPLAY_BRIGHTNESS_ON_SLEEP_MODE_DISABLE
    );
    if (!config.enabled) return;
    if (!(await firstValueFrom(this.brightnessControl.driverIsAvailable()))) return;
    this.brightnessControl.cancelActiveTransition();
    if (!forceInstant && config.transition) {
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
      type: 'displayBrightnessChanged',
      reason: sleepMode ? 'SLEEP_MODE_ENABLED' : 'SLEEP_MODE_DISABLED',
      value: config.brightness,
      transition: config.transition,
      transitionTime: config.transitionTime,
    } as EventLogDisplayBrightnessChanged);
  }
}
