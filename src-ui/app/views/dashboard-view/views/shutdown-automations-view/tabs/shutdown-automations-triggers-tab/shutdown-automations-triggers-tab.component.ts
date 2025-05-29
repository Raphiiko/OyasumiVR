import { Component, DestroyRef, OnInit } from '@angular/core';
import {
  AUTOMATION_CONFIGS_DEFAULT,
  ShutdownAutomationsConfig,
} from '../../../../../../models/automations';

import { AutomationConfigService } from '../../../../../../services/automation-config.service';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { fade, vshrink } from '../../../../../../utils/animations';

@Component({
  selector: 'app-shutdown-automations-triggers-tab',
  templateUrl: './shutdown-automations-triggers-tab.component.html',
  styleUrls: ['./shutdown-automations-triggers-tab.component.scss'],
  animations: [fade(), vshrink()],
  standalone: false,
})
export class ShutdownAutomationsTriggersTabComponent implements OnInit {
  protected config: ShutdownAutomationsConfig = structuredClone(
    AUTOMATION_CONFIGS_DEFAULT.SHUTDOWN_AUTOMATIONS
  );
  protected onSleepActivationWindowStart = '00:00';
  protected onSleepActivationWindowEnd = '00:00';
  protected whenAloneActivationWindowStart = '00:00';
  protected whenAloneActivationWindowEnd = '00:00';

  constructor(
    private automationConfigs: AutomationConfigService,
    private destroyRef: DestroyRef
  ) {}

  ngOnInit() {
    this.automationConfigs.configs
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((configs) => {
        this.config = configs.SHUTDOWN_AUTOMATIONS;
        this.onSleepActivationWindowStart = this.config.triggerOnSleepActivationWindowStart
          .map((v) => v.toString().padStart(2, '0'))
          .join(':');
        this.onSleepActivationWindowEnd = this.config.triggerOnSleepActivationWindowEnd
          .map((v) => v.toString().padStart(2, '0'))
          .join(':');
        this.whenAloneActivationWindowStart = this.config.triggerWhenAloneActivationWindowStart
          .map((v) => v.toString().padStart(2, '0'))
          .join(':');
        this.whenAloneActivationWindowEnd = this.config.triggerWhenAloneActivationWindowEnd
          .map((v) => v.toString().padStart(2, '0'))
          .join(':');
      });
  }

  async onChangeOnSleepActivationWindowStart(value: string) {
    const parsedValue = value
      .split(':')
      .map((v) => parseInt(v))
      .slice(0, 2) as [number, number];
    await this.automationConfigs.updateAutomationConfig<ShutdownAutomationsConfig>(
      'SHUTDOWN_AUTOMATIONS',
      {
        triggerOnSleepActivationWindowStart: parsedValue,
      }
    );
  }

  async onChangeOnSleepActivationWindowEnd(value: string) {
    const parsedValue = value
      .split(':')
      .map((v) => parseInt(v))
      .slice(0, 2) as [number, number];
    await this.automationConfigs.updateAutomationConfig<ShutdownAutomationsConfig>(
      'SHUTDOWN_AUTOMATIONS',
      {
        triggerOnSleepActivationWindowEnd: parsedValue,
      }
    );
  }

  async onSleepDurationChange(duration: number) {
    await this.automationConfigs.updateAutomationConfig<ShutdownAutomationsConfig>(
      'SHUTDOWN_AUTOMATIONS',
      {
        triggerOnSleepDuration: duration,
      }
    );
  }

  async whenAloneDurationChange(duration: number) {
    await this.automationConfigs.updateAutomationConfig<ShutdownAutomationsConfig>(
      'SHUTDOWN_AUTOMATIONS',
      {
        triggerWhenAloneDuration: duration,
      }
    );
  }

  async onChangeWhenAloneActivationWindowStart(value: string) {
    const parsedValue = value
      .split(':')
      .map((v) => parseInt(v))
      .slice(0, 2) as [number, number];
    await this.automationConfigs.updateAutomationConfig<ShutdownAutomationsConfig>(
      'SHUTDOWN_AUTOMATIONS',
      {
        triggerWhenAloneActivationWindowStart: parsedValue,
      }
    );
  }

  async onChangeWhenAloneActivationWindowEnd(value: string) {
    const parsedValue = value
      .split(':')
      .map((v) => parseInt(v))
      .slice(0, 2) as [number, number];
    await this.automationConfigs.updateAutomationConfig<ShutdownAutomationsConfig>(
      'SHUTDOWN_AUTOMATIONS',
      {
        triggerWhenAloneActivationWindowEnd: parsedValue,
      }
    );
  }

  async toggleTriggerOnSleep() {
    await this.automationConfigs.updateAutomationConfig<ShutdownAutomationsConfig>(
      'SHUTDOWN_AUTOMATIONS',
      {
        triggerOnSleep: !this.config.triggerOnSleep,
      }
    );
  }

  async toggleOnSleepActivationWindow() {
    // Toggle the activation window
    const config: Partial<ShutdownAutomationsConfig> = {
      triggerOnSleepActivationWindow: !this.config.triggerOnSleepActivationWindow,
    };
    // Reset the window back to default when turning off the activation window
    if (!config.triggerOnSleepActivationWindow) {
      config.triggerOnSleepActivationWindowStart = structuredClone(
        AUTOMATION_CONFIGS_DEFAULT.SHUTDOWN_AUTOMATIONS.triggerOnSleepActivationWindowStart
      );
      config.triggerOnSleepActivationWindowEnd = structuredClone(
        AUTOMATION_CONFIGS_DEFAULT.SHUTDOWN_AUTOMATIONS.triggerOnSleepActivationWindowEnd
      );
    }
    // Apply & Save
    await this.automationConfigs.updateAutomationConfig<ShutdownAutomationsConfig>(
      'SHUTDOWN_AUTOMATIONS',
      config
    );
  }

  async toggleTriggerWhenAlone() {
    await this.automationConfigs.updateAutomationConfig<ShutdownAutomationsConfig>(
      'SHUTDOWN_AUTOMATIONS',
      {
        triggerWhenAlone: !this.config.triggerWhenAlone,
      }
    );
  }

  async toggleTriggerWhenAloneOnlyWhenSleepModeActive() {
    await this.automationConfigs.updateAutomationConfig<ShutdownAutomationsConfig>(
      'SHUTDOWN_AUTOMATIONS',
      {
        triggerWhenAloneOnlyWhenSleepModeActive:
          !this.config.triggerWhenAloneOnlyWhenSleepModeActive,
      }
    );
  }

  async toggleWhenAloneActivationWindow() {
    // Toggle the activation window
    const config: Partial<ShutdownAutomationsConfig> = {
      triggerWhenAloneActivationWindow: !this.config.triggerWhenAloneActivationWindow,
    };
    // Reset the window back to default when turning off the activation window
    if (!config.triggerWhenAloneActivationWindow) {
      config.triggerWhenAloneActivationWindowStart = structuredClone(
        AUTOMATION_CONFIGS_DEFAULT.SHUTDOWN_AUTOMATIONS.triggerWhenAloneActivationWindowStart
      );
      config.triggerWhenAloneActivationWindowEnd = structuredClone(
        AUTOMATION_CONFIGS_DEFAULT.SHUTDOWN_AUTOMATIONS.triggerWhenAloneActivationWindowEnd
      );
    }
    // Apply & Save
    await this.automationConfigs.updateAutomationConfig<ShutdownAutomationsConfig>(
      'SHUTDOWN_AUTOMATIONS',
      config
    );
  }

  async toggleTriggersEnabled() {
    await this.automationConfigs.updateAutomationConfig<ShutdownAutomationsConfig>(
      'SHUTDOWN_AUTOMATIONS',
      {
        triggersEnabled: !this.config.triggersEnabled,
      }
    );
  }

  private durationToString(sleepDuration: number): string {
    const hours = Math.floor(sleepDuration / 3600000);
    const minutes = Math.floor((sleepDuration % 3600000) / 60000);
    const seconds = Math.floor((sleepDuration % 60000) / 1000);
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds
      .toString()
      .padStart(2, '0')}`;
  }
}
