import { Injectable } from '@angular/core';
import { AutomationConfigService } from './automation-config.service';
import { distinctUntilChanged, map, skip } from 'rxjs';
import { OscGeneralAutomationConfig } from '../models/automations';
import { SleepService } from './sleep.service';
import { OscService } from './osc.service';

@Injectable({
  providedIn: 'root',
})
export class OscGeneralAutomationsService {
  private config?: OscGeneralAutomationConfig;

  constructor(
    private automationConfigService: AutomationConfigService,
    private sleepService: SleepService,
    private osc: OscService
  ) {}

  async init() {
    this.automationConfigService.configs
      .pipe(map((c) => c.OSC_GENERAL))
      .subscribe((c) => (this.config = c));
    this.sleepService.mode
      .pipe(distinctUntilChanged(), skip(1))
      .subscribe((sleepMode) => this.onSleepModeChange(sleepMode));
  }

  private onSleepModeChange(sleepMode: boolean) {
    if (sleepMode && this.config?.onSleepModeEnable) {
      this.osc.queueScript(this.config.onSleepModeEnable, 'OSC_GENERAL_ON_SLEEP_MODE_ENABLE');
    }
    if (!sleepMode && this.config?.onSleepModeDisable) {
      this.osc.queueScript(this.config.onSleepModeDisable, 'OSC_GENERAL_ON_SLEEP_MODE_DISABLE');
    }
  }
}
