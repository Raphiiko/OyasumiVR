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
  PowerDownWindowsMode,
  ShutdownAutomationsConfig,
} from 'src-ui/app/models/automations';
import { AppSettingsService } from 'src-ui/app/services/app-settings.service';
import { AutomationConfigService } from 'src-ui/app/services/automation-config.service';
import { ModalService } from 'src-ui/app/services/modal.service';
import { fade, vshrink } from 'src-ui/app/utils/animations';
import { Router } from '@angular/router';
import { QuitWithSteamVRMode } from '../../../../models/settings';

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

  protected activationWindowStart = '00:00';
  protected activationWindowEnd = '00:00';
  protected lighthouseControlDisabled = false;
  protected quitWithSteamVRMode: QuitWithSteamVRMode = 'DISABLED';
  protected powerDownOptions: SelectBoxItem[] = [
    {
      id: 'SHUTDOWN',
      label: 'shutdown-automations.sequence.powerDownWindows.options.SHUTDOWN',
    },
    {
      id: 'SLEEP',
      label: 'shutdown-automations.sequence.powerDownWindows.options.SLEEP',
    },
    {
      id: 'HIBERNATE',
      label: 'shutdown-automations.sequence.powerDownWindows.options.HIBERNATE',
    },
    {
      id: 'REBOOT',
      label: 'shutdown-automations.sequence.powerDownWindows.options.REBOOT',
    },
    {
      id: 'LOGOUT',
      label: 'shutdown-automations.sequence.powerDownWindows.options.LOGOUT',
    },
  ];
  powerDownOption: SelectBoxItem | undefined;
  sleepDurationString = '00:00:00';

  constructor(
    private destroyRef: DestroyRef,
    private automationConfigs: AutomationConfigService,
    private settingsService: AppSettingsService,
    private modalService: ModalService,
    private shutdownAutomations: ShutdownAutomationsService,
    private router: Router
  ) {}

  ngOnInit() {
    this.settingsService.settings
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((settings) => {
        this.lighthouseControlDisabled = !settings.lighthousePowerControl;
        this.quitWithSteamVRMode = settings.quitWithSteamVR;
      });
    this.automationConfigs.configs
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((configs) => {
        this.config = configs.SHUTDOWN_AUTOMATIONS;
        this.sleepDurationString = this.durationToString(this.config.sleepDuration);
        this.activationWindowStart = this.config.activationWindowStart
          .map((v) => v.toString().padStart(2, '0'))
          .join(':');
        this.activationWindowEnd = this.config.activationWindowEnd
          .map((v) => v.toString().padStart(2, '0'))
          .join(':');
        this.powerDownOption = this.powerDownOptions.find(
          (o) => o.id === configs.SHUTDOWN_AUTOMATIONS.powerDownWindowsMode
        );
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
      !this.config.powerDownWindows
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

  async onSleepDurationChange(value: string) {
    let [hours, minutes, seconds] = value.split(':').map((v) => parseInt(v));
    if (isNaN(hours)) hours = 0;
    if (isNaN(minutes)) minutes = 0;
    if (isNaN(seconds)) seconds = 0;
    const duration = (hours * 3600 + minutes * 60 + seconds) * 1000;
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

  async togglePowerDownWindows() {
    await this.automationConfigs.updateAutomationConfig<ShutdownAutomationsConfig>(
      'SHUTDOWN_AUTOMATIONS',
      {
        powerDownWindows: !this.config.powerDownWindows,
      }
    );
  }

  onChangePowerDownOption(option: SelectBoxItem | undefined) {
    if (!option) return;
    this.automationConfigs.updateAutomationConfig<ShutdownAutomationsConfig>(
      'SHUTDOWN_AUTOMATIONS',
      {
        powerDownWindowsMode: option!.id as PowerDownWindowsMode,
      }
    );
  }

  goToGeneralSettings() {
    this.router.navigate(['dashboard', 'settings', 'general']);
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
