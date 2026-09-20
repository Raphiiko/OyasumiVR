import { Injectable } from '@angular/core';
import { AutomationConfigService } from '../automation-config.service';
import { map } from 'rxjs';
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
    this.sleepService.onSleepModeChangeActions.subscribe(({ mode }) =>
      this.onSleepModeChange(mode)
    );
    this.sleepPreparation.onSleepPreparation.subscribe(() => this.onSleepPreparation());
  }

  private async onSleepModeChange(sleepMode: boolean) {
    if (sleepMode && this.config?.onSleepModeEnable) {
      const result = await this.osc.queueScript(
        this.config.onSleepModeEnable,
        'OSC_GENERAL_ON_SLEEP_MODE_ENABLE'
      );
      if (result.error !== undefined) throw result.error;
    }
    if (!sleepMode && this.config?.onSleepModeDisable) {
      const result = await this.osc.queueScript(
        this.config.onSleepModeDisable,
        'OSC_GENERAL_ON_SLEEP_MODE_DISABLE'
      );
      if (result.error !== undefined) throw result.error;
    }
  }

  private onSleepPreparation() {
    if (this.config?.onSleepPreparation) {
      this.osc.queueScript(this.config.onSleepPreparation, 'OSC_GENERAL_ON_SLEEP_PREPARATION');
    }
  }
}
