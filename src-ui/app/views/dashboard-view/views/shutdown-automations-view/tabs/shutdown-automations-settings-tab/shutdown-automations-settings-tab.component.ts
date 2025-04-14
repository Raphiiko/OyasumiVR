import { Component, DestroyRef, OnInit } from '@angular/core';
import {
  ConfirmModalComponent,
  ConfirmModalInputModel,
  ConfirmModalOutputModel,
} from '../../../../../../components/confirm-modal/confirm-modal.component';
import { filter } from 'rxjs';
import { ShutdownAutomationsService } from '../../../../../../services/shutdown-automations.service';
import { ModalService } from '../../../../../../services/modal.service';
import {
  AUTOMATION_CONFIGS_DEFAULT,
  PowerDownWindowsMode,
  ShutdownAutomationsConfig,
} from '../../../../../../models/automations';

import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AutomationConfigService } from '../../../../../../services/automation-config.service';
import { AppSettingsService } from '../../../../../../services/app-settings.service';
import { QuitWithSteamVRMode } from '../../../../../../models/settings';
import { SelectBoxItem } from '../../../../../../components/select-box/select-box.component';
import { Router } from '@angular/router';
import { fade, vshrink } from '../../../../../../utils/animations';

@Component({
    selector: 'app-shutdown-automations-settings-tab',
    templateUrl: './shutdown-automations-settings-tab.component.html',
    styleUrls: ['./shutdown-automations-settings-tab.component.scss'],
    animations: [fade(), vshrink()],
    standalone: false
})
export class ShutdownAutomationsSettingsTabComponent implements OnInit {
  protected config: ShutdownAutomationsConfig = structuredClone(
    AUTOMATION_CONFIGS_DEFAULT.SHUTDOWN_AUTOMATIONS
  );
  protected quitWithSteamVRMode: QuitWithSteamVRMode = 'DISABLED';
  protected lighthouseControlDisabled = false;
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
  protected powerDownOption: SelectBoxItem | undefined;

  constructor(
    private shutdownAutomations: ShutdownAutomationsService,
    private modalService: ModalService,
    private destroyRef: DestroyRef,
    private automationConfigs: AutomationConfigService,
    private settingsService: AppSettingsService,
    private router: Router
  ) {}

  ngOnInit() {
    this.automationConfigs.configs
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((configs) => {
        this.config = configs.SHUTDOWN_AUTOMATIONS;
        this.powerDownOption = this.powerDownOptions.find(
          (o) => o.id === configs.SHUTDOWN_AUTOMATIONS.powerDownWindowsMode
        );
      });
    this.settingsService.settings
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((settings) => {
        this.lighthouseControlDisabled = !settings.lighthousePowerControl;
        this.quitWithSteamVRMode = settings.quitWithSteamVR;
      });
  }

  protected runSequence() {
    this.modalService
      .addModal<ConfirmModalInputModel, ConfirmModalOutputModel>(ConfirmModalComponent, {
        title: 'shutdown-automations.confirm-modal.title',
        message: 'shutdown-automations.confirm-modal.message',
      })
      .pipe(filter((result) => !!result?.confirmed))
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
}
