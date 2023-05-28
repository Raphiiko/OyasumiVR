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
}
