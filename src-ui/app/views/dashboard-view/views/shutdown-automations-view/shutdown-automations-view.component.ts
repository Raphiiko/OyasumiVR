import { Component, DestroyRef, OnInit } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { cloneDeep } from 'lodash';
import { filter } from 'rxjs';
import { ShutdownAutomationsService } from 'src-ui/app/services/shutdown-automations.service';
import {
  ConfirmModalComponent,
  ConfirmModalInputModel,
  ConfirmModalOutputModel,
} from 'src-ui/app/components/confirm-modal/confirm-modal.component';
import { SelectBoxItem } from 'src-ui/app/components/select-box/select-box.component';
import {
  AUTOMATION_CONFIGS_DEFAULT,
  ShutdownAutomationsConfig,
} from 'src-ui/app/models/automations';
import { AppSettingsService } from 'src-ui/app/services/app-settings.service';
import { AutomationConfigService } from 'src-ui/app/services/automation-config.service';
import { ModalService } from 'src-ui/app/services/modal.service';
import { fade, vshrink } from 'src-ui/app/utils/animations';

@Component({
  selector: 'app-shutdown-automations-view',
  templateUrl: './shutdown-automations-view.component.html',
  styleUrls: ['./shutdown-automations-view.component.scss'],
  animations: [fade(), vshrink()],
})
export class ShutdownAutomationsViewComponent implements OnInit {
  protected config: ShutdownAutomationsConfig = cloneDeep(
    AUTOMATION_CONFIGS_DEFAULT.SHUTDOWN_AUTOMATIONS
  );
  protected durationUnitOptions: SelectBoxItem[] = [
    {
      id: 'SECONDS',
      label: 'Seconds',
    },
    {
      id: 'MINUTES',
      label: 'Minutes',
    },
  ];
  protected onSleepTriggerDurationUnit?: SelectBoxItem = this.durationUnitOptions[0];
  protected duration = 0;
  protected activationWindowStart = '00:00';
  protected activationWindowEnd = '00:00';
  protected lighthouseControlDisabled = false;

  constructor(
    private destroyRef: DestroyRef,
    private automationConfigs: AutomationConfigService,
    private settingsService: AppSettingsService,
    private modalService: ModalService,
    private shutdownAutomations: ShutdownAutomationsService
  ) {}

  ngOnInit() {
    this.settingsService.settings
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((settings) => (this.lighthouseControlDisabled = !settings.lighthousePowerControl));
    this.automationConfigs.configs
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((configs) => {
        this.config = configs.SHUTDOWN_AUTOMATIONS;
        // Parse non 1:1 fields
        this.onSleepTriggerDurationUnit =
          this.config.sleepDuration >= 60000
            ? this.durationUnitOptions[1]
            : this.durationUnitOptions[0];
        this.duration = Math.floor(
          this.config.sleepDuration >= 60000
            ? this.config.sleepDuration / 60000
            : this.config.sleepDuration / 1000
        );
        this.activationWindowStart = this.config.activationWindowStart
          .map((v) => v.toString().padStart(2, '0'))
          .join(':');
        this.activationWindowEnd = this.config.activationWindowEnd
          .map((v) => v.toString().padStart(2, '0'))
          .join(':');
      });
  }

  runSequence() {
    this.modalService
      .addModal<ConfirmModalInputModel, ConfirmModalOutputModel>(ConfirmModalComponent, {
        title: 'shutdown-automations.confirm-modal.title',
        message: 'shutdown-automations.confirm-modal.message',
      })
      .pipe(filter((result) => result.confirmed))
      .subscribe(() => this.shutdownAutomations.runSequence('MANUAL'));
  }

  get noOptionsSelected() {
    return (
      !this.config.quitSteamVR &&
      !this.config.turnOffControllers &&
      !this.config.turnOffTrackers &&
      (!this.config.turnOffBaseStations || this.lighthouseControlDisabled) &&
      !this.config.shutdownWindows
    );
  }

  async onChangeActivationWindowStart(value: string) {
    const parsedValue = value
      .split(':')
      .map((v) => parseInt(v))
      .slice(0, 2) as [number, number];
    await this.automationConfigs.updateAutomationConfig<ShutdownAutomationsConfig>(
      'SHUTDOWN_AUTOMATIONS',
      {
        activationWindowStart: parsedValue,
      }
    );
  }
  async onChangeActivationWindowEnd(value: string) {
    const parsedValue = value
      .split(':')
      .map((v) => parseInt(v))
      .slice(0, 2) as [number, number];
    await this.automationConfigs.updateAutomationConfig<ShutdownAutomationsConfig>(
      'SHUTDOWN_AUTOMATIONS',
      {
        activationWindowEnd: parsedValue,
      }
    );
  }

  async onChangeDuration(value?: number, unit?: string) {
    if (value === undefined || unit === undefined) return;
    const duration = unit === 'SECONDS' ? value * 1000 : value * 60000;
    await this.automationConfigs.updateAutomationConfig<ShutdownAutomationsConfig>(
      'SHUTDOWN_AUTOMATIONS',
      {
        sleepDuration: duration,
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

  async toggleActivationWindow() {
    // Toggle the activation window
    const config: Partial<ShutdownAutomationsConfig> = {
      activationWindow: !this.config.activationWindow,
    };
    // Reset the window back to default when turning off the activation window
    if (!config.activationWindow) {
      config.activationWindowStart = cloneDeep(
        AUTOMATION_CONFIGS_DEFAULT.SHUTDOWN_AUTOMATIONS.activationWindowStart
      );
      config.activationWindowEnd = cloneDeep(
        AUTOMATION_CONFIGS_DEFAULT.SHUTDOWN_AUTOMATIONS.activationWindowEnd
      );
    }
    // Apply & Save
    await this.automationConfigs.updateAutomationConfig<ShutdownAutomationsConfig>(
      'SHUTDOWN_AUTOMATIONS',
      config
    );
  }

  async toggleQuitSteamVR() {
    await this.automationConfigs.updateAutomationConfig<ShutdownAutomationsConfig>(
      'SHUTDOWN_AUTOMATIONS',
      {
        quitSteamVR: !this.config.quitSteamVR,
      }
    );
  }

  async toggleTurnOffControllers() {
    await this.automationConfigs.updateAutomationConfig<ShutdownAutomationsConfig>(
      'SHUTDOWN_AUTOMATIONS',
      {
        turnOffControllers: !this.config.turnOffControllers,
      }
    );
  }

  async toggleTurnOffTrackers() {
    await this.automationConfigs.updateAutomationConfig<ShutdownAutomationsConfig>(
      'SHUTDOWN_AUTOMATIONS',
      {
        turnOffTrackers: !this.config.turnOffTrackers,
      }
    );
  }

  async toggleTurnOffBaseStations() {
    await this.automationConfigs.updateAutomationConfig<ShutdownAutomationsConfig>(
      'SHUTDOWN_AUTOMATIONS',
      {
        turnOffBaseStations: !this.config.turnOffBaseStations,
      }
    );
  }

  async toggleShutdownWindows() {
    await this.automationConfigs.updateAutomationConfig<ShutdownAutomationsConfig>(
      'SHUTDOWN_AUTOMATIONS',
      {
        shutdownWindows: !this.config.shutdownWindows,
      }
    );
  }
}
