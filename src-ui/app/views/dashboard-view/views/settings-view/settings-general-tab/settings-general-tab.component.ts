import { Component, OnInit } from '@angular/core';
import { SettingsTabComponent } from '../settings-tab/settings-tab.component';
import { AppSettingsService } from '../../../../../services/app-settings.service';
import { debounceTime, distinctUntilChanged, Subject } from 'rxjs';
import { LighthouseConsoleService } from '../../../../../services/lighthouse-console.service';
import { open as openFile } from '@tauri-apps/api/dialog';
import { TelemetryService } from '../../../../../services/telemetry.service';
import {
  TELEMETRY_SETTINGS_DEFAULT,
  TelemetrySettings,
} from '../../../../../models/telemetry-settings';
import { cloneDeep } from 'lodash';
import { LANGUAGES } from '../../../../../globals';
import { vshrink } from '../../../../../utils/animations';
import {
  ExecutableReferenceStatus,
  OverlayActivationAction,
  OverlayActivationController,
  QuitWithSteamVRMode,
} from 'src-ui/app/models/settings';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { SelectBoxItem } from 'src-ui/app/components/select-box/select-box.component';
import { LighthouseDevicePowerState } from 'src-ui/app/models/lighthouse-device';
import { ModalService } from '../../../../../services/modal.service';
import { StartWithSteamVRHowToModalComponent } from './confirm-modal/start-with-steamvr-how-to-modal.component';

@Component({
  selector: 'app-settings-general-tab',
  templateUrl: './settings-general-tab.component.html',
  styleUrls: ['./settings-general-tab.component.scss'],
  animations: [vshrink()],
})
export class SettingsGeneralTabComponent extends SettingsTabComponent implements OnInit {
  languages = LANGUAGES;
  lighthouseConsoleStatus: ExecutableReferenceStatus = 'UNKNOWN';
  lighthouseConsolePathAlert?: {
    text: string;
    type: 'INFO' | 'SUCCESS' | 'ERROR';
    loadingIndicator?: boolean;
  };
  lighthouseConsolePathInputChange: Subject<string> = new Subject();
  telemetrySettings: TelemetrySettings = cloneDeep(TELEMETRY_SETTINGS_DEFAULT);
  lighthousePowerOffModeOptions: SelectBoxItem[] = [
    {
      id: 'standby',
      label: 'settings.general.lighthousePowerControl.powerOffMode.standby.title',
      subLabel: 'settings.general.lighthousePowerControl.powerOffMode.standby.description',
    },
    {
      id: 'sleep',
      label: 'settings.general.lighthousePowerControl.powerOffMode.sleep.title',
      subLabel: 'settings.general.lighthousePowerControl.powerOffMode.sleep.description',
    },
  ];
  lighthousePowerOffModeOption: SelectBoxItem | undefined;
  sleepModeStartupBehaviourOptions: SelectBoxItem[] = [
    {
      id: 'PERSIST',
      label: 'settings.general.sleepMode.startupBehaviour.option.persist.title',
      subLabel: 'settings.general.sleepMode.startupBehaviour.option.persist.description',
    },
    {
      id: 'ACTIVE',
      label: 'settings.general.sleepMode.startupBehaviour.option.enabled.title',
      subLabel: 'settings.general.sleepMode.startupBehaviour.option.enabled.description',
    },
    {
      id: 'INACTIVE',
      label: 'settings.general.sleepMode.startupBehaviour.option.disabled.title',
      subLabel: 'settings.general.sleepMode.startupBehaviour.option.disabled.description',
    },
  ];
  sleepModeStartupBehaviourOption: SelectBoxItem | undefined;
  overlayActivationActionOptions: SelectBoxItem[] = [
    {
      id: 'NONE',
      label: 'settings.general.overlay.activation.action.none',
    },
    {
      id: 'SINGLE_A',
      label: 'settings.general.overlay.activation.action.singleA',
    },
    {
      id: 'DOUBLE_A',
      label: 'settings.general.overlay.activation.action.doubleA',
    },
    {
      id: 'TRIPLE_A',
      label: 'settings.general.overlay.activation.action.tripleA',
    },
    {
      id: 'SINGLE_B',
      label: 'settings.general.overlay.activation.action.singleB',
    },
    {
      id: 'DOUBLE_B',
      label: 'settings.general.overlay.activation.action.doubleB',
    },
    {
      id: 'TRIPLE_B',
      label: 'settings.general.overlay.activation.action.tripleB',
    },
  ];
  overlayActivationActionOption: SelectBoxItem | undefined;
  overlayActivationControllerOptions: SelectBoxItem[] = [
    {
      id: 'EITHER',
      label: 'settings.general.overlay.activation.controller.either',
    },
    {
      id: 'RIGHT',
      label: 'settings.general.overlay.activation.controller.right',
    },
    {
      id: 'LEFT',
      label: 'settings.general.overlay.activation.controller.left',
    },
  ];
  overlayActivationControllerOption: SelectBoxItem | undefined;
  stopWithSteamVROptions: SelectBoxItem[] = [
    {
      id: 'DISABLED',
      label: 'settings.general.stopWithSteamVR.options.DISABLED',
    },
    {
      id: 'IMMEDIATELY',
      label: 'settings.general.stopWithSteamVR.options.IMMEDIATELY',
    },
    {
      id: 'AFTERDELAY',
      label: 'settings.general.stopWithSteamVR.options.AFTERDELAY',
    },
  ];
  stopWithSteamVROption: SelectBoxItem | undefined;

  constructor(
    settingsService: AppSettingsService,
    private lighthouse: LighthouseConsoleService,
    private telemetry: TelemetryService,
    private modalService: ModalService
  ) {
    super(settingsService);
  }

  override ngOnInit(): void {
    super.ngOnInit();
    this.lighthouse.consoleStatus
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((status) => this.processLighthouseConsoleStatus(status));
    this.lighthouseConsolePathInputChange
      .pipe(takeUntilDestroyed(this.destroyRef), distinctUntilChanged(), debounceTime(500))
      .subscribe(async (path) => {
        await this.lighthouse.setConsolePath(path);
      });
    this.telemetry.settings
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((telemetrySettings) => {
        this.telemetrySettings = telemetrySettings;
      });
    this.settingsService.settings
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((settings) => {
        this.lighthousePowerOffModeOption = this.lighthousePowerOffModeOptions.find(
          (o) => o.id === settings.lighthousePowerOffState
        );
        this.sleepModeStartupBehaviourOption = this.sleepModeStartupBehaviourOptions.find(
          (o) => o.id === settings.sleepModeStartupBehaviour
        );
        this.overlayActivationActionOption = this.overlayActivationActionOptions.find(
          (o) => o.id === settings.overlayActivationAction
        );
        this.overlayActivationControllerOption = this.overlayActivationControllerOptions.find(
          (o) => o.id === settings.overlayActivationController
        );
        this.stopWithSteamVROption = this.stopWithSteamVROptions.find(
          (o) => o.id === settings.quitWithSteamVR
        );
      });
  }

  setUserLanguage(languageCode: string) {
    this.settingsService.updateSettings({ userLanguage: languageCode });
  }

  processLighthouseConsoleStatus(status: ExecutableReferenceStatus) {
    this.lighthouseConsoleStatus = status;
    const statusToAlertType: {
      [s: string]: 'INFO' | 'SUCCESS' | 'ERROR';
    } = { CHECKING: 'INFO', SUCCESS: 'SUCCESS' };
    this.lighthouseConsolePathAlert = [
      'NOT_FOUND',
      'INVALID_EXECUTABLE',
      'PERMISSION_DENIED',
      'INVALID_FILENAME',
      'UNKNOWN_ERROR',
      'CHECKING',
      'SUCCESS',
    ].includes(status)
      ? {
          type: statusToAlertType[status] || 'ERROR',
          text: 'settings.general.lighthouseConsole.status.' + status,
          loadingIndicator: status === 'CHECKING',
        }
      : undefined;
  }

  async browseForLighthouseConsole() {
    const path = await openFile({
      defaultPath:
        'C:\\Program Files (x86)\\Steam\\steamapps\\common\\SteamVR\\tools\\lighthouse\\bin\\win64',
      directory: false,
      multiple: false,
      filters: [
        {
          name: 'Lighthouse Console',
          extensions: ['exe'],
        },
      ],
    });
    if (path && typeof path === 'string') await this.lighthouse.setConsolePath(path);
  }

  setAskForAdminOnStart(enabled: boolean) {
    this.settingsService.updateSettings({ askForAdminOnStart: enabled });
  }

  setTelemetryEnabled(enabled: boolean) {
    this.telemetry.updateSettings({ enabled });
  }

  setExitInSystemTray(exitInSystemTray: boolean) {
    this.settingsService.updateSettings({ exitInSystemTray });
  }

  setStartInSystemTray(startInSystemTray: boolean) {
    this.settingsService.updateSettings({ startInSystemTray });
  }

  setLighthousePowerControl(enabled: boolean) {
    this.settingsService.updateSettings({ lighthousePowerControl: enabled });
  }

  onChangeLighthousePowerOffMode(option: SelectBoxItem | undefined) {
    if (!option) return;
    this.settingsService.updateSettings({
      lighthousePowerOffState: option.id as LighthouseDevicePowerState,
    });
  }

  onChangeSleepModeStartupBehaviour(option: SelectBoxItem | undefined) {
    if (!option) return;
    this.settingsService.updateSettings({
      sleepModeStartupBehaviour: option.id as 'PERSIST' | 'ACTIVE' | 'INACTIVE',
    });
  }

  onChangeOverlayActivationAction(option: SelectBoxItem | undefined) {
    if (!option) return;
    this.settingsService.updateSettings({
      overlayActivationAction: option.id as OverlayActivationAction,
    });
  }

  onChangeOverlayActivationController(option: SelectBoxItem | undefined) {
    if (!option) return;
    this.settingsService.updateSettings({
      overlayActivationController: option.id as OverlayActivationController,
    });
  }

  setOverlayActivationTriggerRequired(required: boolean) {
    this.settingsService.updateSettings({ overlayActivationTriggerRequired: required });
  }

  onChangeStopWithSteamVROption(option: SelectBoxItem | undefined) {
    if (!option) return;
    this.settingsService.updateSettings({
      quitWithSteamVR: option!.id as QuitWithSteamVRMode,
    });
  }

  showStartWithSteamVRHowToModal() {
    this.modalService.addModal(StartWithSteamVRHowToModalComponent).subscribe();
  }
}
