import { Injectable } from '@angular/core';
import { AutomationConfigService } from './automation-config.service';
import { SleepService } from './sleep.service';
import {
  BehaviorSubject,
  combineLatest,
  debounceTime,
  delay,
  distinctUntilChanged,
  filter,
  firstValueFrom,
  interval,
  map,
  merge,
  Observable,
  of,
  pairwise,
  skip,
  startWith,
  switchMap,
  take,
  tap,
} from 'rxjs';
import { CancellableTask } from '../utils/cancellable-task';
import { EventLogService } from './event-log.service';
import {
  BrightnessAutomationsConfig,
  BrightnessEvent,
  BrightnessEventAutomationConfig,
} from '../models/automations';
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
import { invoke } from '@tauri-apps/api';
import { error } from 'tauri-plugin-log-api';
import { listen } from '@tauri-apps/api/event';
import { OpenVRService } from './openvr.service';

@Injectable({
  providedIn: 'root',
})
export class BrightnessCctAutomationService {
  private lastActivatedBrightnessTransition = new BehaviorSubject<{
    tasks: CancellableTask[];
    automation: BrightnessEvent;
  } | null>(null);
  private lastActivatedCCTTransition = new BehaviorSubject<{
    tasks: CancellableTask[];
    automation: BrightnessEvent;
  } | null>(null);
  private autoSunsetTime?: string;
  private autoSunriseTime?: string;
  private sleepMode: boolean = false;

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
    private sleepPreparation: SleepPreparationService,
    private openvr: OpenVRService
  ) {}

  async init() {
    // Run automations when the HMD gets connected
    this.openvr.devices
      .pipe(
        map((devices) => devices.find((d) => d.class === 'HMD')?.serialNumber ?? null),
        distinctUntilChanged(),
        pairwise(),
        filter(([prev, current]) => prev === null && current !== null),
        debounceTime(3000)
      )
      .subscribe(() => this.onHmdConnect());
    // Run automations when the sleep mode changes
    this.sleepService.mode
      .pipe(
        tap((mode) => (this.sleepMode = mode)),
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
    // Listen for minute starts
    await listen<void>('CRON_MINUTE_START', () => this.onMinuteTick());
    // Automatically fetch sunset/sunrise times when none are configured
    interval(1000 * 60 * 5)
      .pipe(
        startWith(null),
        delay(2000),
        switchMap(() => this.automationConfigService.configs.pipe(take(1)))
      )
      .subscribe(async (configs) => {
        // Check if the sunset/sunrise times are already configured
        const config = configs.BRIGHTNESS_AUTOMATIONS;
        if (config.AT_SUNRISE.activationTime !== null && config.AT_SUNSET.activationTime !== null)
          return;
        // Fetch the sunset/sunrise times if needed
        if (!this.autoSunsetTime || !this.autoSunriseTime) {
          try {
            const [sunrise, sunset] = await invoke<[string, string]>('get_sunrise_sunset_time');
            this.autoSunriseTime = sunrise;
            this.autoSunsetTime = sunset;
          } catch (e) {
            error('[BrightnessCctAutomationService] Failed to fetch sunrise/sunset times: ' + e);
            return;
          }
        }
        // Update the config if needed
        const patch: Partial<BrightnessAutomationsConfig> = {};
        if (config.AT_SUNRISE.activationTime === null) {
          patch.AT_SUNRISE = {
            ...config.AT_SUNRISE,
            activationTime: this.autoSunriseTime,
          };
        }
        if (config.AT_SUNSET.activationTime === null) {
          patch.AT_SUNSET = {
            ...config.AT_SUNSET,
            activationTime: this.autoSunsetTime,
          };
        }
        await this.automationConfigService.updateAutomationConfig<BrightnessAutomationsConfig>(
          'BRIGHTNESS_AUTOMATIONS',
          patch
        );
      });
  }

  public isBrightnessTransitionActive(automation: BrightnessEvent): Observable<boolean> {
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

  public isCCTTransitionActive(automation: BrightnessEvent): Observable<boolean> {
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

  private async onHmdConnect() {
    const config = await firstValueFrom(this.automationConfigService.configs).then(
      (c) => c.BRIGHTNESS_AUTOMATIONS
    );
    let brightnessAutomation:
      | 'AT_SUNSET'
      | 'AT_SUNRISE'
      | 'SLEEP_MODE_ENABLE'
      | 'SLEEP_MODE_DISABLE'
      | undefined;
    let cctAutomation:
      | 'AT_SUNSET'
      | 'AT_SUNRISE'
      | 'SLEEP_MODE_ENABLE'
      | 'SLEEP_MODE_DISABLE'
      | undefined;
    // If sunrise/sunset times are both enabled, use their settings for brightness and CCT, if configured.
    if (
      config.AT_SUNSET.enabled &&
      config.AT_SUNRISE.enabled &&
      config.AT_SUNSET.activationTime &&
      config.AT_SUNRISE.activationTime
    ) {
      const d = new Date();
      const currentHour = d.getHours();
      const currentMinute = d.getMinutes();
      const [sunriseHour, sunriseMinute] = config.AT_SUNRISE.activationTime.split(':');
      const [sunsetHour, sunsetMinute] = config.AT_SUNSET.activationTime.split(':');
      const currentTime = currentHour * 3600 + currentMinute * 60;
      const sunriseTime = parseInt(sunriseHour) * 3600 + parseInt(sunriseMinute) * 60;
      const sunsetTime = parseInt(sunsetHour) * 3600 + parseInt(sunsetMinute) * 60;
      const timesInverted = sunriseTime >= sunsetTime;
      const firstTime = timesInverted ? sunsetTime : sunriseTime;
      const secondTime = timesInverted ? sunriseTime : sunsetTime;
      let runAutomation: BrightnessEvent;
      if (currentTime < firstTime || currentTime >= secondTime) {
        runAutomation = timesInverted ? 'AT_SUNRISE' : 'AT_SUNSET';
      } else {
        runAutomation = timesInverted ? 'AT_SUNSET' : 'AT_SUNRISE';
      }
      if (config[runAutomation].changeBrightness) brightnessAutomation = runAutomation;
      if (config[runAutomation].changeColorTemperature) cctAutomation = runAutomation;
    }
    // Otherwise, use the values configured for the sleep mode automations (if they're enabled)
    const sleepMode = await firstValueFrom(this.sleepService.mode);
    // Brightness
    if (
      !brightnessAutomation &&
      sleepMode &&
      config.SLEEP_MODE_ENABLE.enabled &&
      config.SLEEP_MODE_ENABLE.changeBrightness
    )
      brightnessAutomation = 'SLEEP_MODE_ENABLE';
    else if (
      !brightnessAutomation &&
      !sleepMode &&
      config.SLEEP_MODE_DISABLE.enabled &&
      config.SLEEP_MODE_DISABLE.changeBrightness
    )
      brightnessAutomation = 'SLEEP_MODE_DISABLE';
    // CCT
    if (
      !cctAutomation &&
      sleepMode &&
      config.SLEEP_MODE_ENABLE.enabled &&
      config.SLEEP_MODE_ENABLE.changeColorTemperature
    )
      cctAutomation = 'SLEEP_MODE_ENABLE';
    else if (
      !cctAutomation &&
      !sleepMode &&
      config.SLEEP_MODE_DISABLE.enabled &&
      config.SLEEP_MODE_DISABLE.changeColorTemperature
    )
      cctAutomation = 'SLEEP_MODE_DISABLE';
    if (brightnessAutomation)
      this.onAutomationTrigger(
        brightnessAutomation,
        config[brightnessAutomation],
        true,
        false,
        true,
        false
      );
    if (cctAutomation)
      this.onAutomationTrigger(cctAutomation, config[cctAutomation], true, false, false, true);
  }

  private async onAutomationTrigger(
    automationType: BrightnessEvent,
    config: BrightnessEventAutomationConfig,
    forceInstant = false,
    logging = true,
    runBrightness = true,
    runCCT = true
  ) {
    // Stop if the automation is disabled
    if (!config.enabled || (!config.changeBrightness && !config.changeColorTemperature)) return;
    // Determine the log reason
    const eventLogReasonMap: Record<BrightnessEvent, SetBrightnessOrCCTReason> = {
      SLEEP_MODE_ENABLE: 'SLEEP_MODE_ENABLE',
      SLEEP_MODE_DISABLE: 'SLEEP_MODE_DISABLE',
      SLEEP_PREPARATION: 'SLEEP_PREPARATION',
      AT_SUNRISE: 'AT_SUNRISE',
      AT_SUNSET: 'AT_SUNSET',
    };
    const logReason: SetBrightnessOrCCTReason = eventLogReasonMap[automationType];
    // Handle CCT
    if (config.changeColorTemperature && runCCT) {
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
      if (logging && eventLogReason) {
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
    if (config.changeBrightness && runBrightness) {
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
      if (logging && eventLogReason) {
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

  private async onMinuteTick() {
    // Run automation when the sunset/sunrise times trigger
    const configs = await firstValueFrom(this.automationConfigService.configs);
    const config = configs.BRIGHTNESS_AUTOMATIONS;
    if (!config.AT_SUNSET.enabled && !config.AT_SUNRISE.enabled) return;
    const d = new Date();
    const currentHour = d.getHours();
    const currentMinute = d.getMinutes();
    const currentTime = `${currentHour.toString(10).padStart(2, '0')}:${currentMinute
      .toString(10)
      .padStart(2, '0')}`;
    const sunriseTime = config.AT_SUNRISE.activationTime ?? this.autoSunriseTime;
    const sunsetTime = config.AT_SUNSET.activationTime ?? this.autoSunsetTime;
    if (
      config.AT_SUNSET.enabled &&
      sunsetTime === currentTime &&
      (!config.AT_SUNSET.onlyWhenSleepDisabled || !this.sleepMode)
    ) {
      await this.onAutomationTrigger('AT_SUNSET', config.AT_SUNSET);
    }
    if (
      config.AT_SUNRISE.enabled &&
      sunriseTime === currentTime &&
      (!config.AT_SUNRISE.onlyWhenSleepDisabled || !this.sleepMode)
    ) {
      await this.onAutomationTrigger('AT_SUNRISE', config.AT_SUNRISE);
    }
  }
}
