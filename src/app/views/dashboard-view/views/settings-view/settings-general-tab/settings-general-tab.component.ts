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
import { ExecutableReferenceStatus } from 'src/app/models/settings';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { SelectBoxItem } from 'src/app/components/select-box/select-box.component';
import { LighthouseDevicePowerState } from 'src/app/models/lighthouse-device';

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

  constructor(
    settingsService: AppSettingsService,
    private lighthouse: LighthouseConsoleService,
    private telemetry: TelemetryService
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
}
