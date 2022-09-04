import { Injectable } from '@angular/core';
import { AutomationConfigService } from './automation-config.service';
import { map, Observable } from 'rxjs';
import { AUTOMATION_CONFIGS_DEFAULT, GPUPowerLimitsAutomationConfig } from '../models/automations';
import { cloneDeep } from 'lodash';

@Injectable({
  providedIn: 'root',
})
export class GpuAutomationService {
  private config: GPUPowerLimitsAutomationConfig = cloneDeep(
    AUTOMATION_CONFIGS_DEFAULT.GPU_POWER_LIMITS
  );
  constructor(private automationConfig: AutomationConfigService) {}
  async init() {
    this.automationConfig.configs
      .pipe(map((configs) => configs.GPU_POWER_LIMITS))
      .subscribe((config) => (this.config = config));
  }

  isEnabled(): Observable<boolean> {
    return this.automationConfig.configs.pipe(map((configs) => configs.GPU_POWER_LIMITS.enabled));
  }

  enable() {
    this.automationConfig.updateAutomationConfig('GPU_POWER_LIMITS', { enabled: true });
  }

  disable() {
    this.automationConfig.updateAutomationConfig('GPU_POWER_LIMITS', { enabled: false });
  }
}
