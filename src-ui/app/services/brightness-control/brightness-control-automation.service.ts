import { Injectable } from '@angular/core';
import { AutomationConfigService } from '../automation-config.service';
import { SleepService } from '../sleep.service';
import {
  debounceTime,
  distinctUntilChanged,
  filter,
  firstValueFrom,
  map,
  merge,
  skip,
  switchMap,
  take,
} from 'rxjs';
import { CancellableTask } from '../../utils/cancellable-task';
import { EventLogService } from '../event-log.service';
import { SimpleBrightnessControlService } from './simple-brightness-control.service';
import { DisplayBrightnessControlService } from './display-brightness-control.service';
import { ImageBrightnessControlService } from './image-brightness-control.service';
import { SetBrightnessAutomationConfig } from '../../models/automations';
import { OpenVRService } from '../openvr.service';
import { SetBrightnessReason } from './brightness-control-models';
import {
  EventLogDisplayBrightnessChanged,
  EventLogImageBrightnessChanged,
  EventLogSimpleBrightnessChanged,
} from '../../models/event-log-entry';

type BrightnessAutomationType = 'SLEEP_MODE_ENABLE' | 'SLEEP_MODE_DISABLE' | 'SLEEP_PREPARATION';

@Injectable({
  providedIn: 'root',
})
export class BrightnessControlAutomationService {
  private lastActivatedTransition?: {
    tasks: CancellableTask[];
    automation: BrightnessAutomationType;
  };
  private mode: 'SIMPLE' | 'ADVANCED' = 'SIMPLE';

  constructor(
    private automationConfigService: AutomationConfigService,
    private sleepService: SleepService,
    private simpleBrightnessControl: SimpleBrightnessControlService,
    private displayBrightnessControl: DisplayBrightnessControlService,
    private imageBrightnessControl: ImageBrightnessControlService,
    private eventLog: EventLogService,
    private openvr: OpenVRService
  ) {}

  async init() {
    // Keep track of the advanced mode being enabled or not
    this.automationConfigService.configs
      .pipe(map((configs) => configs.BRIGHTNESS_CONTROL_ADVANCED_MODE))
      .subscribe((config) => (this.mode = config.enabled ? 'ADVANCED' : 'SIMPLE'));
    // Run automations when the sleep mode changes
    this.sleepService.mode
      .pipe(
        skip(1),
        distinctUntilChanged(),
        switchMap(async (sleepMode) => {
          const config = await firstValueFrom(this.automationConfigService.configs).then((c) =>
            sleepMode
              ? c.SET_BRIGHTNESS_ON_SLEEP_MODE_ENABLE
              : c.SET_BRIGHTNESS_ON_SLEEP_MODE_DISABLE
          );
          await this.onAutomationTrigger(
            sleepMode ? 'SLEEP_MODE_ENABLE' : 'SLEEP_MODE_DISABLE',
            config
          );
        })
      )
      .subscribe();
    // Run automations when OyasumiVR starts, or SteamVR is started
    merge(
      this.sleepService.mode.pipe(
        debounceTime(500),
        take(1),
        map((sleepMode) => ({ reason: 'OYASUMIVR' as 'OYASUMIVR' | 'STEAMVR', sleepMode }))
      ),
      this.openvr.status.pipe(
        distinctUntilChanged(),
        filter((status) => status === 'INITIALIZED'),
        debounceTime(500),
        switchMap(() => this.sleepService.mode.pipe(take(1))),
        map((sleepMode) => ({ reason: 'STEAMVR' as 'OYASUMIVR' | 'STEAMVR', sleepMode }))
      )
    )
      .pipe(debounceTime(500))
      .subscribe(async ({ sleepMode, reason }) => {
        const configs = await firstValueFrom(this.automationConfigService.configs);
        if (configs.SET_BRIGHTNESS_ON_SLEEP_MODE_ENABLE.applyOnStart && sleepMode) {
          await this.onAutomationTrigger(
            'SLEEP_MODE_ENABLE',
            configs.SET_BRIGHTNESS_ON_SLEEP_MODE_ENABLE,
            true,
            reason
          );
        }
        if (configs.SET_BRIGHTNESS_ON_SLEEP_MODE_DISABLE.applyOnStart && !sleepMode) {
          await this.onAutomationTrigger(
            'SLEEP_MODE_DISABLE',
            configs.SET_BRIGHTNESS_ON_SLEEP_MODE_DISABLE,
            true,
            reason
          );
        }
      });
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

  private isTransitionActive(automation: BrightnessAutomationType) {
    if (this.lastActivatedTransition?.automation !== automation) return false;
    return [
      this.displayBrightnessControl.activeTransition,
      this.imageBrightnessControl.activeTransition,
      this.simpleBrightnessControl.activeTransition,
    ].some((t) => !!t && this.lastActivatedTransition?.tasks.includes(t));
  }

  private async onAutomationTrigger(
    automationType: BrightnessAutomationType,
    config: Omit<SetBrightnessAutomationConfig, 'applyOnStart'>,
    forceInstant = false,
    onStart?: 'OYASUMIVR' | 'STEAMVR'
  ) {
    // Stop if the automation is disabled
    if (!config.enabled) return;
    // Determine the log reason
    const logReasonMap: Record<BrightnessAutomationType, SetBrightnessReason> = {
      SLEEP_MODE_ENABLE: 'SLEEP_MODE_ENABLE',
      SLEEP_MODE_DISABLE: 'SLEEP_MODE_DISABLE',
      SLEEP_PREPARATION: 'SLEEP_PREPARATION',
    };
    const onStartLogReasonMap: Record<'OYASUMIVR' | 'STEAMVR', SetBrightnessReason> = {
      OYASUMIVR: 'OYASUMIVR_START',
      STEAMVR: 'STEAMVR_START',
    };
    const eventLogReasonMap: Record<
      BrightnessAutomationType,
      EventLogSimpleBrightnessChanged['reason']
    > = {
      SLEEP_MODE_ENABLE: 'SLEEP_MODE_ENABLED',
      SLEEP_MODE_DISABLE: 'SLEEP_MODE_DISABLED',
      SLEEP_PREPARATION: 'SLEEP_PREPARATION',
    };
    const logReason: SetBrightnessReason = onStart
      ? onStartLogReasonMap[onStart]
      : logReasonMap[automationType];
    // Cancel any active transitions
    this.simpleBrightnessControl.cancelActiveTransition();
    this.displayBrightnessControl.cancelActiveTransition();
    this.imageBrightnessControl.cancelActiveTransition();
    // Apply the brightness changes
    const advancedMode = await firstValueFrom(this.automationConfigService.configs).then(
      (c) => c.BRIGHTNESS_CONTROL_ADVANCED_MODE.enabled
    );
    if (!forceInstant && config.transition) {
      const tasks: CancellableTask[] = (() => {
        if (advancedMode) {
          return [
            this.imageBrightnessControl.transitionBrightness(
              config.imageBrightness,
              config.transitionTime,
              {
                logReason: logReasonMap[automationType],
              }
            ),
            this.displayBrightnessControl.transitionBrightness(
              config.displayBrightness,
              config.transitionTime,
              {
                logReason: logReasonMap[automationType],
              }
            ),
          ];
        } else {
          return [
            this.simpleBrightnessControl.transitionBrightness(
              config.brightness,
              config.transitionTime,
              {
                logReason: logReasonMap[automationType],
              }
            ),
          ];
        }
      })();
      this.lastActivatedTransition = {
        tasks,
        automation: automationType,
      };
    } else {
      if (advancedMode) {
        await this.imageBrightnessControl.setBrightness(config.imageBrightness, {
          logReason: logReasonMap[automationType],
        });
        await this.displayBrightnessControl.setBrightness(config.displayBrightness, {
          logReason: logReasonMap[automationType],
        });
      } else {
        await this.simpleBrightnessControl.setBrightness(config.brightness, {
          logReason: logReasonMap[automationType],
        });
      }
    }
    // We do not log events for onStart type triggers (for now)
    if (onStart) return;
    const eventLogReason = eventLogReasonMap[automationType];
    if (!eventLogReason) return;
    if (advancedMode) {
      this.eventLog.logEvent({
        type: 'imageBrightnessChanged',
        reason: eventLogReason,
        value: config.brightness,
        transition: config.transition,
        transitionTime: config.transitionTime,
      } as EventLogImageBrightnessChanged);
      this.eventLog.logEvent({
        type: 'displayBrightnessChanged',
        reason: eventLogReason,
        value: config.brightness,
        transition: config.transition,
        transitionTime: config.transitionTime,
      } as EventLogDisplayBrightnessChanged);
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
