import { Injectable } from '@angular/core';
import { AutomationConfigService } from '../automation-config.service';
import { OpenVRService } from '../openvr.service';
import {
  AUTOMATION_CONFIGS_DEFAULT,
  SleepModeDisableAfterTimeAutomationConfig,
} from '../../models/automations';
import { cloneDeep } from 'lodash';
import { distinctUntilChanged, interval, map } from 'rxjs';
import { SleepService } from '../sleep.service';

@Injectable({
  providedIn: 'root',
})
export class SleepModeDisableAfterTimeAutomationService {
  private config: SleepModeDisableAfterTimeAutomationConfig = cloneDeep(
    AUTOMATION_CONFIGS_DEFAULT.SLEEP_MODE_DISABLE_AFTER_TIME
  );
  sleepLastEnabled = -1;
  sleepEnabled = false;
  threshold = -1;

  constructor(
    private automationConfig: AutomationConfigService,
    private openvr: OpenVRService,
    private sleep: SleepService
  ) {}

  async init() {
    this.automationConfig.configs
      .pipe(map((configs) => configs.SLEEP_MODE_DISABLE_AFTER_TIME))
      .subscribe((config) => {
        this.config = config;
        if (config.duration) {
          const [hours, minutes] = config.duration.split(':').map((v) => parseInt(v));
          this.threshold = hours * 60 * 60 * 1000 + minutes * 60 * 1000;
        }
      });
    this.sleep.mode.pipe(distinctUntilChanged()).subscribe((mode) => {
      this.sleepEnabled = mode;
      this.sleepLastEnabled = mode ? Date.now() : -1;
    });
    interval(1000).subscribe(() => this.onTick());
  }

  async onTick() {
    if (!this.config.enabled || !this.config.duration) return;
    const d = new Date();
    if (this.threshold <= 0 || this.sleepLastEnabled <= 0) return;
    if (this.sleepEnabled && Date.now() - this.sleepLastEnabled >= this.threshold) {
      this.sleepEnabled = false;
      this.sleepLastEnabled = -1;
      await this.sleep.disableSleepMode({
        type: 'AUTOMATION',
        automation: 'SLEEP_MODE_DISABLE_AFTER_TIME',
      });
    }
  }
}
