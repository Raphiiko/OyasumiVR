import { Component, DestroyRef, OnInit } from '@angular/core';
import { AutomationConfigService } from '../../../../../../services/automation-config.service';
import { AppSettingsService } from '../../../../../../services/app-settings.service';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  AUTOMATION_CONFIGS_DEFAULT,
  BigscreenBeyondFanControlAutomationsConfig,
  BigscreenBeyondRgbControlAutomationsConfig,
} from '../../../../../../models/automations';
import { cloneDeep } from 'lodash';
import { APP_SETTINGS_DEFAULT, AppSettings } from '../../../../../../models/settings';
import { hshrink } from '../../../../../../utils/animations';
import { SET_BRIGHTNESS_OPTIONS_DEFAULTS } from '../../../../../../services/brightness-control/brightness-control-models';
import { HardwareBrightnessControlService } from '../../../../../../services/brightness-control/hardware-brightness-control.service';

const MIN_SAFE_FAN_SPEED = 40;
const AUTOMATION_ENABLE_KEYS = ['onSleepEnable', 'onSleepDisable', 'onSleepPreparation'];

@Component({
  selector: 'app-hmd-automations-bigscreen-beyond-tab',
  templateUrl: './hmd-automations-bigscreen-beyond-tab.component.html',
  styleUrls: ['./hmd-automations-bigscreen-beyond-tab.component.scss'],
  animations: [hshrink()],
})
export class HmdAutomationsBigscreenBeyondTabComponent implements OnInit {
  protected readonly fanAutomationEnableKeys = AUTOMATION_ENABLE_KEYS as Array<
    keyof BigscreenBeyondFanControlAutomationsConfig
  >;
  protected readonly rgbAutomationEnableKeys = AUTOMATION_ENABLE_KEYS as Array<
    keyof BigscreenBeyondRgbControlAutomationsConfig
  >;
  protected rgbControlConfig: BigscreenBeyondRgbControlAutomationsConfig = cloneDeep(
    AUTOMATION_CONFIGS_DEFAULT.BIGSCREEN_BEYOND_RGB_CONTROL
  );
  protected fanControlConfig: BigscreenBeyondFanControlAutomationsConfig = cloneDeep(
    AUTOMATION_CONFIGS_DEFAULT.BIGSCREEN_BEYOND_FAN_CONTROL
  );
  protected appSettings: AppSettings = cloneDeep(APP_SETTINGS_DEFAULT);

  constructor(
    private automationConfigService: AutomationConfigService,
    private appSettingsService: AppSettingsService,
    private destroyRef: DestroyRef,
    private hardwareBrightness: HardwareBrightnessControlService
  ) {}

  ngOnInit() {
    this.automationConfigService.configs
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((configs) => {
        this.rgbControlConfig = configs.BIGSCREEN_BEYOND_RGB_CONTROL;
        this.fanControlConfig = configs.BIGSCREEN_BEYOND_FAN_CONTROL;
      });
    this.appSettingsService.settings
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((settings) => {
        this.appSettings = settings;
      });
  }

  async toggleFanAutomation(key: keyof BigscreenBeyondFanControlAutomationsConfig) {
    await this.automationConfigService.updateAutomationConfig<BigscreenBeyondFanControlAutomationsConfig>(
      'BIGSCREEN_BEYOND_FAN_CONTROL',
      {
        [key]: !this.fanControlConfig[key],
      }
    );
  }

  async toggleRgbAutomation(key: keyof BigscreenBeyondRgbControlAutomationsConfig) {
    await this.automationConfigService.updateAutomationConfig<BigscreenBeyondRgbControlAutomationsConfig>(
      'BIGSCREEN_BEYOND_RGB_CONTROL',
      {
        [key]: !this.rgbControlConfig[key],
      }
    );
  }

  async toggleUnsafeFanSpeed() {
    const allow = !this.fanControlConfig.allowUnsafeFanSpeed;
    const config: Partial<BigscreenBeyondFanControlAutomationsConfig> = {
      allowUnsafeFanSpeed: allow,
    };
    if (!allow) {
      if (this.fanControlConfig.onSleepEnableFanSpeed < MIN_SAFE_FAN_SPEED)
        config['onSleepEnableFanSpeed'] = MIN_SAFE_FAN_SPEED;
      if (this.fanControlConfig.onSleepDisableFanSpeed < MIN_SAFE_FAN_SPEED)
        config['onSleepDisableFanSpeed'] = MIN_SAFE_FAN_SPEED;
      if (this.fanControlConfig.onSleepPreparationFanSpeed < MIN_SAFE_FAN_SPEED)
        config['onSleepPreparationFanSpeed'] = MIN_SAFE_FAN_SPEED;
      // TODO: SET THE FAN SPEED BACK TO SAFE LEVELS IF NEEDED
    }
    await this.automationConfigService.updateAutomationConfig<BigscreenBeyondFanControlAutomationsConfig>(
      'BIGSCREEN_BEYOND_FAN_CONTROL',
      config
    );
  }

  async updateFanAutomationSpeed(
    automation: keyof BigscreenBeyondFanControlAutomationsConfig,
    speed: number
  ) {
    await this.automationConfigService.updateAutomationConfig<BigscreenBeyondFanControlAutomationsConfig>(
      'BIGSCREEN_BEYOND_FAN_CONTROL',
      {
        [automation + 'FanSpeed']: speed,
      }
    );
  }

  async updateRgbAutomation(
    automation: keyof BigscreenBeyondRgbControlAutomationsConfig,
    value: [number, number, number]
  ) {
    await this.automationConfigService.updateAutomationConfig<BigscreenBeyondRgbControlAutomationsConfig>(
      'BIGSCREEN_BEYOND_RGB_CONTROL',
      {
        [automation + 'Rgb']: value,
      }
    );
  }

  toggleBigscreenBeyondForceFanBrightnessSafety() {
    this.appSettingsService.updateSettings({
      bigscreenBeyondForceFanBrightnessSafety:
        !this.appSettings.bigscreenBeyondForceFanBrightnessSafety,
    });
    // Set brightness to same value to reset fan safety if needed
    this.hardwareBrightness.setBrightness(
      this.hardwareBrightness.brightness,
      SET_BRIGHTNESS_OPTIONS_DEFAULTS,
      true
    );
  }

  protected readonly MIN_SAFE_FAN_SPEED = MIN_SAFE_FAN_SPEED;

  protected asFanControlKey(s: string): keyof BigscreenBeyondFanControlAutomationsConfig {
    return s as keyof BigscreenBeyondFanControlAutomationsConfig;
  }

  protected asRgbControlKey(s: string): keyof BigscreenBeyondRgbControlAutomationsConfig {
    return s as keyof BigscreenBeyondRgbControlAutomationsConfig;
  }

  asNumber(value: unknown): number {
    return value as number;
  }

  asColor(value: unknown): [number, number, number] {
    return value as [number, number, number];
  }
}
