import { Injectable } from '@angular/core';
import { AutomationConfigService } from '../automation-config.service';
import { distinctUntilChanged, map, skip } from 'rxjs';
import { OscGeneralAutomationConfig } from '../../models/automations';
import { SleepService } from '../sleep.service';
import { OscService } from '../osc.service';
import { SleepPreparationService } from '../sleep-preparation.service';

@Injectable({
  providedIn: 'root',
})
export class OscGeneralAutomationsService {
  private config?: OscGeneralAutomationConfig;

  constructor(
    private automationConfigService: AutomationConfigService,
    private sleepService: SleepService,
    private osc: OscService,
    private sleepPreparation: SleepPreparationService
  ) {}

  async init() {
    this.automationConfigService.configs
      .pipe(map((c) => c.OSC_GENERAL))
      .subscribe((c) => (this.config = c));
    this.sleepService.mode
      .pipe(distinctUntilChanged(), skip(1))
      .subscribe((sleepMode) => this.onSleepModeChange(sleepMode));
    this.sleepPreparation.onSleepPreparation.subscribe(() => this.onSleepPreparation());
  }

  private onSleepModeChange(sleepMode: boolean) {
    if (sleepMode && this.config?.onSleepModeEnable) {
      this.osc.queueScript(this.config.onSleepModeEnable, 'OSC_GENERAL_ON_SLEEP_MODE_ENABLE');
    }
    if (!sleepMode && this.config?.onSleepModeDisable) {
      this.osc.queueScript(this.config.onSleepModeDisable, 'OSC_GENERAL_ON_SLEEP_MODE_DISABLE');
    }
  }

  private onSleepPreparation() {
    if (this.config?.onSleepPreparation) {
      this.osc.queueScript(this.config.onSleepPreparation, 'OSC_GENERAL_ON_SLEEP_PREPARATION');
    }
  }
}
