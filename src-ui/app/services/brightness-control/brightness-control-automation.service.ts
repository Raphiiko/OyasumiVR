import { Injectable } from '@angular/core';
import { AutomationConfigService } from '../automation-config.service';
import { SleepService } from '../sleep.service';
import {
  BehaviorSubject,
  combineLatest,
  distinctUntilChanged,
  firstValueFrom,
  map,
  merge,
  Observable,
  of,
  skip,
  startWith,
  switchMap,
  take,
} from 'rxjs';
import { CancellableTask } from '../../utils/cancellable-task';
import { EventLogService } from '../event-log.service';
import { SimpleBrightnessControlService } from './simple-brightness-control.service';
import { HardwareBrightnessControlService } from './hardware-brightness-control.service';
import { SoftwareBrightnessControlService } from './software-brightness-control.service';
import { BrightnessEventAutomationConfig } from '../../models/automations';
import { OpenVRService } from '../openvr.service';
import { SetBrightnessReason } from './brightness-control-models';
import {
  EventLogHardwareBrightnessChanged,
  EventLogSimpleBrightnessChanged,
  EventLogSoftwareBrightnessChanged,
} from '../../models/event-log-entry';
import { SleepPreparationService } from '../sleep-preparation.service';

type BrightnessAutomationType =
  | 'SLEEP_MODE_ENABLE'
  | 'SLEEP_MODE_DISABLE'
  | 'SLEEP_PREPARATION'
  | 'AT_SUNSET'
  | 'AT_SUNRISE';

@Injectable({
  providedIn: 'root',
})
export class BrightnessControlAutomationService {
  private lastActivatedTransition = new BehaviorSubject<{
    tasks: CancellableTask[];
    automation: BrightnessAutomationType;
  } | null>(null);
  private mode: 'SIMPLE' | 'ADVANCED' = 'SIMPLE';

  public readonly anyTransitionActive = this.lastActivatedTransition.pipe(
    switchMap((lastActivatedTransition) =>
      combineLatest(
        (lastActivatedTransition?.tasks ?? []).map((task) =>
          merge(task.onCancelled, task.onError, task.onComplete).pipe(
            take(1),
            map(() => true),
            startWith(task.isComplete() || task.isError() || task.isCancelled())
          )
        )
      )
    ),
    map((transitions) => transitions.some((t) => !t))
  );

  constructor(
    private automationConfigService: AutomationConfigService,
    private sleepService: SleepService,
    private simpleBrightnessControl: SimpleBrightnessControlService,
    private hardwareBrightnessControl: HardwareBrightnessControlService,
    private softwareBrightnessControl: SoftwareBrightnessControlService,
    private eventLog: EventLogService,
    private openvr: OpenVRService,
    private sleepPreparation: SleepPreparationService
  ) {}

  async init() {
    // Keep track of the advanced mode being enabled or not
    this.automationConfigService.configs
      .pipe(map((configs) => configs.BRIGHTNESS_AUTOMATIONS.advancedMode))
      .subscribe((advancedMode) => (this.mode = advancedMode ? 'ADVANCED' : 'SIMPLE'));
    // Run automations when the sleep mode changes
    this.sleepService.mode
      .pipe(
        skip(1),
        distinctUntilChanged(),
        switchMap(async (sleepMode) => {
          const config = await firstValueFrom(this.automationConfigService.configs).then((c) =>
            sleepMode
              ? c.BRIGHTNESS_AUTOMATIONS.SLEEP_MODE_ENABLE
              : c.BRIGHTNESS_AUTOMATIONS.SLEEP_MODE_DISABLE
          );
          await this.onAutomationTrigger(
            sleepMode ? 'SLEEP_MODE_ENABLE' : 'SLEEP_MODE_DISABLE',
            config
          );
        })
      )
      .subscribe();
    // Run automation when sleep preparation is activated
    this.sleepPreparation.onSleepPreparation
      .pipe(
        switchMap(() => this.automationConfigService.configs),
        switchMap((configs) =>
          this.onAutomationTrigger(
            'SLEEP_PREPARATION',
            configs.BRIGHTNESS_AUTOMATIONS.SLEEP_PREPARATION
          )
        )
      )
      .subscribe();
  }

  public isTransitionActive(automation: BrightnessAutomationType): Observable<boolean> {
    return this.lastActivatedTransition.pipe(
      switchMap((lastActivatedTransition) => {
        if (lastActivatedTransition?.automation !== automation) return of(false);
        return combineLatest([
          this.hardwareBrightnessControl.activeTransition,
          this.softwareBrightnessControl.activeTransition,
          this.simpleBrightnessControl.activeTransition,
        ]).pipe(
          map((activeTransitions) => {
            return activeTransitions.some((t) => !!t && lastActivatedTransition?.tasks.includes(t));
          })
        );
      })
    );
  }

  private async onAutomationTrigger(
    automationType: BrightnessAutomationType,
    config: BrightnessEventAutomationConfig,
    forceInstant = false
  ) {
    // Stop if the automation is disabled
    if (!config.enabled) return;
    // Determine the log reason
    const eventLogReasonMap: Record<BrightnessAutomationType, SetBrightnessReason> = {
      SLEEP_MODE_ENABLE: 'SLEEP_MODE_ENABLE',
      SLEEP_MODE_DISABLE: 'SLEEP_MODE_DISABLE',
      SLEEP_PREPARATION: 'SLEEP_PREPARATION',
      AT_SUNRISE: 'AT_SUNRISE',
      AT_SUNSET: 'AT_SUNSET',
    };
    const logReason: SetBrightnessReason = eventLogReasonMap[automationType];
    // Cancel any active transitions
    this.simpleBrightnessControl.cancelActiveTransition();
    this.hardwareBrightnessControl.cancelActiveTransition();
    this.softwareBrightnessControl.cancelActiveTransition();
    // Apply the brightness changes
    const advancedMode = await firstValueFrom(this.automationConfigService.configs).then(
      (c) => c.BRIGHTNESS_AUTOMATIONS.advancedMode
    );
    if (!forceInstant && config.transition) {
      const tasks: CancellableTask[] = await (async () => {
        if (advancedMode) {
          const tasks = [
            this.softwareBrightnessControl.transitionBrightness(
              config.softwareBrightness,
              config.transitionTime,
              {
                logReason,
              }
            ),
          ];
          if (await firstValueFrom(this.hardwareBrightnessControl.driverIsAvailable)) {
            tasks.push(
              this.hardwareBrightnessControl.transitionBrightness(
                config.hardwareBrightness,
                config.transitionTime,
                {
                  logReason,
                }
              )
            );
          }
          return tasks;
        } else {
          return [
            this.simpleBrightnessControl.transitionBrightness(
              config.brightness,
              config.transitionTime,
              {
                logReason,
              }
            ),
          ];
        }
      })();
      this.lastActivatedTransition.next({
        tasks,
        automation: automationType,
      });
    } else {
      if (advancedMode) {
        await this.softwareBrightnessControl.setBrightness(config.softwareBrightness, {
          logReason,
        });
        if (await firstValueFrom(this.hardwareBrightnessControl.driverIsAvailable)) {
          await this.hardwareBrightnessControl.setBrightness(config.hardwareBrightness, {
            logReason,
          });
        }
      } else {
        await this.simpleBrightnessControl.setBrightness(config.brightness, {
          logReason,
        });
      }
    }
    const eventLogReason = eventLogReasonMap[automationType];
    if (!eventLogReason) return;
    if (advancedMode) {
      this.eventLog.logEvent({
        type: 'softwareBrightnessChanged',
        reason: eventLogReason,
        value: config.brightness,
        transition: config.transition,
        transitionTime: config.transitionTime,
      } as EventLogSoftwareBrightnessChanged);
      this.eventLog.logEvent({
        type: 'hardwareBrightnessChanged',
        reason: eventLogReason,
        value: config.brightness,
        transition: config.transition,
        transitionTime: config.transitionTime,
      } as EventLogHardwareBrightnessChanged);
    } else {
      this.eventLog.logEvent({
        type: 'simpleBrightnessChanged',
        reason: eventLogReason,
        value: config.brightness,
        transition: config.transition,
        transitionTime: config.transitionTime,
      } as EventLogSimpleBrightnessChanged);
    }
  }
}
