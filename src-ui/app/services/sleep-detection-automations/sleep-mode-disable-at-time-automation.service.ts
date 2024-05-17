import { Injectable } from '@angular/core';
import { AutomationConfigService } from '../automation-config.service';
import { listen } from '@tauri-apps/api/event';
import {
  AUTOMATION_CONFIGS_DEFAULT,
  SleepModeDisableAtTimeAutomationConfig,
} from '../../models/automations';
import { cloneDeep } from 'lodash';
import { map } from 'rxjs';
import { SleepService } from '../sleep.service';

@Injectable({
  providedIn: 'root',
})
export class SleepModeDisableAtTimeAutomationService {
  private config: SleepModeDisableAtTimeAutomationConfig = cloneDeep(
    AUTOMATION_CONFIGS_DEFAULT.SLEEP_MODE_DISABLE_AT_TIME
  );

  constructor(private automationConfig: AutomationConfigService, private sleep: SleepService) {}

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
      this.sleep.disableSleepMode({
        type: 'AUTOMATION',
        automation: 'SLEEP_MODE_DISABLE_AT_TIME',
      });
    }
  }
}
