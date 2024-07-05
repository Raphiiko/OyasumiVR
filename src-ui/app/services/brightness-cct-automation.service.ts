import { Injectable } from '@angular/core';
import { AutomationConfigService } from './automation-config.service';
import { SleepService } from './sleep.service';
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
import { CancellableTask } from '../utils/cancellable-task';
import { EventLogService } from './event-log.service';
import { BrightnessEventAutomationConfig } from '../models/automations';
import { OpenVRService } from './openvr.service';
import {
  EventLogCCTChanged,
  EventLogHardwareBrightnessChanged,
  EventLogSimpleBrightnessChanged,
  EventLogSoftwareBrightnessChanged,
} from '../models/event-log-entry';
import { SleepPreparationService } from './sleep-preparation.service';
import { SimpleBrightnessControlService } from './brightness-control/simple-brightness-control.service';
import { HardwareBrightnessControlService } from './brightness-control/hardware-brightness-control.service';
import { SoftwareBrightnessControlService } from './brightness-control/software-brightness-control.service';
import { CCTControlService } from './cct-control/cct-control.service';
import { SetBrightnessOrCCTReason } from './brightness-control/brightness-control-models';

type BrightnessAutomationType =
  | 'SLEEP_MODE_ENABLE'
  | 'SLEEP_MODE_DISABLE'
  | 'SLEEP_PREPARATION'
  | 'AT_SUNSET'
  | 'AT_SUNRISE';

@Injectable({
  providedIn: 'root',
})
export class BrightnessCctAutomationService {
  private lastActivatedBrightnessTransition = new BehaviorSubject<{
    tasks: CancellableTask[];
    automation: BrightnessAutomationType;
  } | null>(null);
  private lastActivatedCCTTransition = new BehaviorSubject<{
    tasks: CancellableTask[];
    automation: BrightnessAutomationType;
  } | null>(null);

  public readonly anyBrightnessTransitionActive = this.lastActivatedBrightnessTransition.pipe(
    switchMap((transition) =>
      combineLatest(
        (transition?.tasks ?? []).map((task) =>
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

  public readonly anyCCTTransitionActive = this.lastActivatedCCTTransition.pipe(
    switchMap((transition) =>
      combineLatest(
        (transition?.tasks ?? []).map((task) =>
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
    private cctControl: CCTControlService,
    private eventLog: EventLogService,
    private openvr: OpenVRService,
    private sleepPreparation: SleepPreparationService
  ) {}

  async init() {
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

  public isBrightnessTransitionActive(automation: BrightnessAutomationType): Observable<boolean> {
    return this.lastActivatedBrightnessTransition.pipe(
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

  public isCCTTransitionActive(automation: BrightnessAutomationType): Observable<boolean> {
    return this.lastActivatedCCTTransition.pipe(
      switchMap((transition) => {
        if (transition?.automation !== automation) return of(false);
        return combineLatest([this.cctControl.activeTransition]).pipe(
          map((activeTransitions) => {
            return activeTransitions.some((t) => !!t && transition?.tasks.includes(t));
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
    if (!config.enabled || (!config.changeBrightness && !config.changeColorTemperature)) return;
    // Determine the log reason
    const eventLogReasonMap: Record<BrightnessAutomationType, SetBrightnessOrCCTReason> = {
      SLEEP_MODE_ENABLE: 'SLEEP_MODE_ENABLE',
      SLEEP_MODE_DISABLE: 'SLEEP_MODE_DISABLE',
      SLEEP_PREPARATION: 'SLEEP_PREPARATION',
      AT_SUNRISE: 'AT_SUNRISE',
      AT_SUNSET: 'AT_SUNSET',
    };
    const logReason: SetBrightnessOrCCTReason = eventLogReasonMap[automationType];
    // Handle CCT
    if (config.changeColorTemperature) {
      this.cctControl.cancelActiveTransition();
      // Apply the CCT changes
      if (!forceInstant && config.transition) {
        const task = this.cctControl.transitionCCT(config.colorTemperature, config.transitionTime, {
          logReason,
        });
        this.lastActivatedCCTTransition.next({
          tasks: [task],
          automation: automationType,
        });
      } else {
        await this.cctControl.setCCT(config.colorTemperature, { logReason });
      }
      const eventLogReason = eventLogReasonMap[automationType];
      if (eventLogReason) {
        this.eventLog.logEvent({
          type: 'cctChanged',
          reason: eventLogReason,
          value: config.colorTemperature,
          transition: config.transition,
          transitionTime: config.transitionTime,
        } as EventLogCCTChanged);
      }
    }
    // Handle Brightness
    if (config.changeBrightness) {
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
        this.lastActivatedBrightnessTransition.next({
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
      if (eventLogReason) {
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
  }
}
