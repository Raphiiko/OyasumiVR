import { Injectable } from '@angular/core';
import { firstValueFrom, map } from 'rxjs';
import { AUTOMATION_DEFAULT_CONFIG, TimeEventAutomationConfig } from '../../models/automations';
import { AutomationConfigService } from '../automation-config.service';
import { cloneDeep } from 'lodash';
import { listen } from '@tauri-apps/api/event';
import { OpenVRService } from '../openvr.service';

@Injectable({
  providedIn: 'root',
})
export class BatteryTimeEventAutomationService {
  config: TimeEventAutomationConfig = cloneDeep(AUTOMATION_DEFAULT_CONFIG.TIME_EVENT);

  constructor(private automationConfig: AutomationConfigService, private openvr: OpenVRService) {}

  async init() {
    this.automationConfig.configs
      .pipe(map((configs) => configs.TIME_EVENT))
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
      const devices = await firstValueFrom(
        this.openvr.devices.pipe(
          map((devices) =>
            devices.filter((device) => this.config.powerOffClasses.includes(device.class))
          )
        )
      );
      await this.openvr.turnOffDevices(devices);
    }
  }
}
