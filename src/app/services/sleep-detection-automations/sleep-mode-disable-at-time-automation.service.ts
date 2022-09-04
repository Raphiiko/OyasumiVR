import { Injectable } from '@angular/core';
import { AutomationConfigService } from '../automation-config.service';
import { listen } from '@tauri-apps/api/event';
import { OpenVRService } from '../openvr.service';
import {
  AUTOMATION_CONFIGS_DEFAULT,
  SleepModeDisableAtTimeAutomationConfig,
  SleepModeEnableAtTimeAutomationConfig,
} from '../../models/automations';
import { cloneDeep } from 'lodash';
import { map } from 'rxjs';
import { SleepModeService } from '../sleep-mode.service';

@Injectable({
  providedIn: 'root',
})
export class SleepModeDisableAtTimeAutomationService {
  private config: SleepModeDisableAtTimeAutomationConfig = cloneDeep(
    AUTOMATION_CONFIGS_DEFAULT.SLEEP_MODE_DISABLE_AT_TIME
  );

  constructor(
    private automationConfig: AutomationConfigService,
    private openvr: OpenVRService,
    private sleepModeService: SleepModeService
  ) {}

  async init() {
    this.automationConfig.configs
      .pipe(map((configs) => configs.SLEEP_MODE_DISABLE_AT_TIME))
      .subscribe((config) => (this.config = config));
    await listen<void>('CRON_MINUTE_START', () => this.onTick());
  }

  async onTick() {
    if (!this.config.enabled || !this.config.time) return;
    const d = new Date();
    const currentHour = d.getHours();
    const currentMinute = d.getMinutes();
    const [scheduledHour, scheduledMinute] = this.config.time
      .split(':')
      .map((component) => parseInt(component));
    if (currentHour === scheduledHour && currentMinute === scheduledMinute) {
      this.sleepModeService.disableSleepMode({
        type: 'AUTOMATION',
        automation: 'SLEEP_MODE_DISABLE_AT_TIME',
      });
    }
  }
}
