import { Component, DestroyRef, OnInit } from '@angular/core';
import { debounceTime, distinctUntilChanged, Subject } from 'rxjs';
import { open as openFile } from '@tauri-apps/api/dialog';
import {
  APP_SETTINGS_DEFAULT,
  AppSettings,
  DiscordActivityMode,
  ExecutableReferenceStatus,
  QuitWithSteamVRMode,
} from 'src-ui/app/models/settings';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { SelectBoxItem } from 'src-ui/app/components/select-box/select-box.component';
import { LighthouseDevicePowerState } from 'src-ui/app/models/lighthouse-device';
import { StartWithSteamVRHowToModalComponent } from './start-with-steamvr-how-to-modal/start-with-steamvr-how-to-modal.component';
import { TelemetryService } from 'src-ui/app/services/telemetry.service';
import { LighthouseConsoleService } from 'src-ui/app/services/lighthouse-console.service';
import { AppSettingsService } from 'src-ui/app/services/app-settings.service';
import { ModalService } from 'src-ui/app/services/modal.service';

import { LANGUAGES } from '../../../../globals';
import { vshrink } from '../../../../utils/animations';
import {
  TELEMETRY_SETTINGS_DEFAULT,
  TelemetrySettings,
} from '../../../../models/telemetry-settings';
import { OVRInputEventAction } from 'src-ui/app/models/ovr-input-event';

@Component({
  selector: 'app-settings-general-view',
  templateUrl: './settings-general-view.component.html',
  styleUrls: ['./settings-general-view.component.scss'],
  animations: [vshrink()],
})
export class SettingsGeneralViewComponent implements OnInit {
  appSettings: AppSettings = structuredClone(APP_SETTINGS_DEFAULT);
  languages = LANGUAGES;
  lighthouseConsoleStatus: ExecutableReferenceStatus = 'UNKNOWN';
  lighthouseConsolePathAlert?: {
    text: string;
    type: 'INFO' | 'SUCCESS' | 'ERROR';
    loadingIndicator?: boolean;
  };
  lighthouseConsolePathInputChange: Subject<string> = new Subject();
  telemetrySettings: TelemetrySettings = structuredClone(TELEMETRY_SETTINGS_DEFAULT);
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
  discordActivityModeOptions: SelectBoxItem[] = [
    {
      id: 'ENABLED',
      label: 'settings.general.discord.activityMode.options.ENABLED',
    },
    {
      id: 'ONLY_ASLEEP',
      label: 'settings.general.discord.activityMode.options.ONLY_ASLEEP',
    },
    {
      id: 'DISABLED',
      label: 'settings.general.discord.activityMode.options.DISABLED',
    },
  ];
  discordActivityModeOption: SelectBoxItem | undefined;

  constructor(
    private lighthouse: LighthouseConsoleService,
    private telemetry: TelemetryService,
    private modalService: ModalService,
    private destroyRef: DestroyRef,
    private settingsService: AppSettingsService
  ) {}

  ngOnInit(): void {
    this.settingsService.settings
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((settings) => (this.appSettings = settings));
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
        this.stopWithSteamVROption = this.stopWithSteamVROptions.find(
          (o) => o.id === settings.quitWithSteamVR
        );
        this.discordActivityModeOption = this.discordActivityModeOptions.find(
          (o) => o.id === settings.discordActivityMode
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

  setOverlayMenuEnabled(enabled: boolean) {
    this.settingsService.updateSettings({ overlayMenuEnabled: enabled });
  }

  setOverlayMenuOnlyOpenWhenVRChatIsRunning(enabled: boolean) {
    this.settingsService.updateSettings({ overlayMenuOnlyOpenWhenVRChatIsRunning: enabled });
  }

  setDiscordActivityOnlyWhenVRChatIsRunning(enabled: boolean) {
    this.settingsService.updateSettings({ discordActivityOnlyWhileVRChatIsRunning: enabled });
  }

  onChangeStopWithSteamVROption(option: SelectBoxItem | undefined) {
    if (!option) return;
    this.settingsService.updateSettings({
      quitWithSteamVR: option!.id as QuitWithSteamVRMode,
    });
  }

  onChangeDiscordActivityMode(option: SelectBoxItem | undefined) {
    if (!option) return;
    this.settingsService.updateSettings({
      discordActivityMode: option!.id as DiscordActivityMode,
    });
  }

  showStartWithSteamVRHowToModal() {
    this.modalService.addModal(StartWithSteamVRHowToModalComponent).subscribe();
  }

  protected readonly OVRInputEventAction = OVRInputEventAction;
}
