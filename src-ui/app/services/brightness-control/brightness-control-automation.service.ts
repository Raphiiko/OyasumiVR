import { Injectable } from '@angular/core';
import { AutomationConfigService } from '../automation-config.service';
import { SleepService } from '../sleep.service';
import { distinctUntilChanged, firstValueFrom, skip } from 'rxjs';
import { CancellableTask } from '../../utils/cancellable-task';
import { EventLogService } from '../event-log.service';
import { EventLogImageBrightnessChanged } from 'src-ui/app/models/event-log-entry';
import { BrightnessControlService } from './brightness-control.service';

@Injectable({
  providedIn: 'root',
})
export class BrightnessControlAutomationService {
  private lastActivatedTransition?: {
    task: CancellableTask;
    automation: 'SLEEP_MODE_ENABLE' | 'SLEEP_MODE_DISABLE' | 'SLEEP_PREPARATION';
  };

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
    // Apply current mode at startup
    // of(null)
    //   .pipe(
    //     delay(2000),
    //     switchMap(() => this.sleepService.mode),
    //     take(1)
    //   )
    //   .subscribe((sleepMode) => this.onSleepModeChange(sleepMode, true));
  }

  public get isSleepEnableTransitionActive() {
    return this.isTransitionActive('SLEEP_MODE_ENABLE');
  }

  public get isSleepDisableTransitionActive() {
    return this.isTransitionActive('SLEEP_MODE_DISABLE');
  }

  public get isSleepPreparationTransitionActive() {
    return this.isTransitionActive('SLEEP_PREPARATION');
  }

  private isTransitionActive(
    automation: 'SLEEP_MODE_ENABLE' | 'SLEEP_MODE_DISABLE' | 'SLEEP_PREPARATION'
  ) {
    const activeTransition = this.brightnessControl.activeTransition;
    return (
      this.lastActivatedTransition?.automation === automation &&
      !!activeTransition &&
      activeTransition === this.lastActivatedTransition?.task
    );
  }

  private async onSleepModeChange(sleepMode: boolean, forceInstant = false) {
    // const config = await firstValueFrom(this.automationConfigService.configs).then((c) =>
    //   sleepMode ? c.IMAGE_BRIGHTNESS_ON_SLEEP_MODE_ENABLE : c.IMAGE_BRIGHTNESS_ON_SLEEP_MODE_DISABLE
    // );
    // if (!config.enabled) return;
    // this.imageBrightnessControl.cancelActiveTransition();
    // if (!forceInstant && config.transition) {
    //   const task = this.imageBrightnessControl.transitionBrightness(
    //     config.brightness,
    //     config.transitionTime,
    //     'BRIGHTNESS_AUTOMATION'
    //   );
    //   this.lastActivatedTransition = {
    //     task,
    //     sleepMode,
    //   };
    // } else {
    //   await this.imageBrightnessControl.setBrightness(config.brightness, 'BRIGHTNESS_AUTOMATION');
    // }
    // this.eventLog.logEvent({
    //   type: 'imageBrightnessChanged',
    //   reason: sleepMode ? 'SLEEP_MODE_ENABLED' : 'SLEEP_MODE_DISABLED',
    //   value: config.brightness,
    //   transition: config.transition,
    //   transitionTime: config.transitionTime,
    // } as EventLogImageBrightnessChanged);
  }
}
