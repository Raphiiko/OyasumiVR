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
    this.automationConfigService.configs
      .pipe(map((configs) => configs.BRIGHTNESS_CONTROL_ADVANCED_MODE))
      .subscribe((config) => (this.mode = config.enabled ? 'ADVANCED' : 'SIMPLE'));
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
          await this.onAutomationTrigger('SLEEP_MODE_ENABLE', config);
        })
      )
      .subscribe();
    merge(
      this.sleepService.mode.pipe(debounceTime(500), take(1)),
      this.openvr.status.pipe(
        filter((status) => status === 'INITIALIZED'),
        distinctUntilChanged(),
        debounceTime(500)
      )
    )
      .pipe(debounceTime(500))
      .subscribe(async (sleepMode) => {
        const configs = await firstValueFrom(this.automationConfigService.configs);
        if (configs.SET_BRIGHTNESS_ON_SLEEP_MODE_ENABLE.applyOnStart) {
          await this.onAutomationTrigger(
            'SLEEP_MODE_ENABLE',
            configs.SET_BRIGHTNESS_ON_SLEEP_MODE_ENABLE,
            false,
            true
          );
        }
        if (configs.SET_BRIGHTNESS_ON_SLEEP_MODE_DISABLE.applyOnStart) {
          await this.onAutomationTrigger(
            'SLEEP_MODE_DISABLE',
            configs.SET_BRIGHTNESS_ON_SLEEP_MODE_DISABLE,
            false,
            true
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
    onStart = false
  ) {
    const advancedMode = await firstValueFrom(this.automationConfigService.configs).then(
      (c) => c.BRIGHTNESS_CONTROL_ADVANCED_MODE.enabled
    );
    if (!config.enabled) return;
    this.simpleBrightnessControl.cancelActiveTransition();
    this.displayBrightnessControl.cancelActiveTransition();
    this.imageBrightnessControl.cancelActiveTransition();
    if (!forceInstant && config.transition) {
      let tasks: CancellableTask[] = (() => {
        if (advancedMode) {
          return [
            this.imageBrightnessControl.transitionBrightness(
              config.imageBrightness,
              config.transitionTime,
              'INDIRECT'
            ),
            this.displayBrightnessControl.transitionBrightness(
              config.displayBrightness,
              config.transitionTime,
              'INDIRECT'
            ),
          ];
        } else {
          return [
            this.simpleBrightnessControl.transitionBrightness(
              config.brightness,
              config.transitionTime,
              'INDIRECT'
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
        await this.imageBrightnessControl.setBrightness(config.imageBrightness, 'INDIRECT');
        await this.displayBrightnessControl.setBrightness(config.displayBrightness, 'INDIRECT');
      } else {
        await this.simpleBrightnessControl.setBrightness(config.brightness, 'INDIRECT');
      }
    }
    if (onStart) return;
    // TODO: LOGGING
    // this.eventLog.logEvent({
    //   type: 'imageBrightnessChanged',
    //   reason: sleepMode ? 'SLEEP_MODE_ENABLED' : 'SLEEP_MODE_DISABLED',
    //   value: config.brightness,
    //   transition: config.transition,
    //   transitionTime: config.transitionTime,
    // } as EventLogImageBrightnessChanged);
  }
}
