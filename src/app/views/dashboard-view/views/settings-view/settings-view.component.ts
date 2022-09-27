import { Component, OnDestroy, OnInit } from '@angular/core';
import { APP_SETTINGS_DEFAULT, AppSettings } from '../../../../models/settings';
import { cloneDeep } from 'lodash';
import {
  AppSettingsService,
  SETTINGS_KEY_APP_SETTINGS,
} from '../../../../services/app-settings.service';
import { debounceTime, distinctUntilChanged, firstValueFrom, Subject, takeUntil } from 'rxjs';
import { LighthouseConsoleStatus, OpenVRService } from '../../../../services/openvr.service';
import { hshrink, noop, vshrink } from '../../../../utils/animations';
import { message, open as openFile } from '@tauri-apps/api/dialog';
import { SETTINGS_KEY_AUTOMATION_CONFIGS } from '../../../../services/automation-config.service';
import { Store } from 'tauri-plugin-store-api';
import { SETTINGS_FILE } from '../../../../globals';
import { Router } from '@angular/router';
import { readTextFile } from '@tauri-apps/api/fs';
import { TranslateService } from '@ngx-translate/core';
import { LighthouseService } from '../../../../services/lighthouse.service';
import { getVersion } from '@tauri-apps/api/app';
import { UpdateService } from '../../../../services/update.service';
import { UpdateManifest } from '@tauri-apps/api/updater';
import { HttpClient } from '@angular/common/http';
import { marked } from 'marked';
import { TELEMETRY_SETTINGS_DEFAULT, TelemetrySettings } from 'src/app/models/telemetry-settings';
import { TelemetryService } from '../../../../services/telemetry.service';

@Component({
  selector: 'app-settings-view',
  templateUrl: './settings-view.component.html',
  styleUrls: ['./settings-view.component.scss'],
  animations: [vshrink(), noop(), hshrink()],
})
export class SettingsViewComponent implements OnInit, OnDestroy {
  storeKey = { SETTINGS_KEY_APP_SETTINGS, SETTINGS_KEY_AUTOMATION_CONFIGS };
  private store = new Store(SETTINGS_FILE);

  destroy$: Subject<void> = new Subject<void>();
  appSettings: AppSettings = cloneDeep(APP_SETTINGS_DEFAULT);
  telemetrySettings: TelemetrySettings = cloneDeep(TELEMETRY_SETTINGS_DEFAULT);
  lighthouseConsoleStatus: LighthouseConsoleStatus = 'UNKNOWN';
  lighthouseConsolePathAlert?: {
    text: string;
    type: 'INFO' | 'SUCCESS' | 'ERROR';
    loadingIndicator?: boolean;
  };
  lighthouseConsolePathInputChange: Subject<string> = new Subject();
  activeTab: 'GENERAL' | 'UPDATES' | 'DEBUG' = 'GENERAL';
  languages: Array<{ code: string; label: string; flag?: string }> = [
    {
      code: 'en',
      label: 'English',
      flag: 'gb',
    },
    {
      code: 'nl',
      label: 'Nederlands',
    },
  ];
  updateAvailable: { checked: boolean; manifest?: UpdateManifest } = { checked: false };
  version: string = '';
  changelog: string = '';
  updateOrCheckInProgress = false;

  constructor(
    protected settingsService: AppSettingsService,
    public openvr: OpenVRService,
    private router: Router,
    private translate: TranslateService,
    private lighthouse: LighthouseService,
    private update: UpdateService,
    private http: HttpClient,
    private telemetry: TelemetryService
  ) {}

  async ngOnInit() {
    this.lighthouse.consoleStatus
      .pipe(takeUntil(this.destroy$))
      .subscribe((status) => this.processLighthouseConsoleStatus(status));
    this.lighthouseConsolePathInputChange
      .pipe(takeUntil(this.destroy$), distinctUntilChanged(), debounceTime(500))
      .subscribe(async (path) => {
        await this.lighthouse.setConsolePath(path);
      });
    this.settingsService.settings.pipe(takeUntil(this.destroy$)).subscribe((appSettings) => {
      this.appSettings = appSettings;
    });
    this.telemetry.settings.pipe(takeUntil(this.destroy$)).subscribe((telemetrySettings) => {
      this.telemetrySettings = telemetrySettings;
    });
    this.version = await getVersion();
    if (this.version === '0.0.0') this.version = 'DEV';
    this.update.updateAvailable.pipe(takeUntil(this.destroy$)).subscribe((available) => {
      this.updateAvailable = available;
    });
    this.changelog = await this.getChangeLog();
  }

  async getChangeLog(): Promise<string> {
    let changelog = '';
    try {
      changelog = await firstValueFrom(
        this.http.get('https://raw.githubusercontent.com/Raphiiko/Oyasumi/main/CHANGELOG.md', {
          responseType: 'text',
        })
      );
    } catch (e) {
      changelog = await firstValueFrom(
        this.http.get('/assets/CHANGELOG.md', {
          responseType: 'text',
        })
      );
    }
    let firstIndex = changelog.indexOf('##');
    changelog = changelog.slice(firstIndex, changelog.length);
    changelog = marked.parse(changelog);
    changelog = changelog.replace(/<a /g, '<a target="_blank" ');
    return changelog;
  }

  processLighthouseConsoleStatus(status: LighthouseConsoleStatus) {
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

  ngOnDestroy() {
    this.destroy$.next();
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

  async clearStore(key?: string) {
    if (!key) {
      await this.store.clear();
    } else {
      await this.store.delete(key);
    }
    await this.store.save();
    await this.router.navigate(['/']);
    window.location.reload();
  }

  setUserLanguage(languageCode: string) {
    this.settingsService.updateSettings({ userLanguage: languageCode });
  }

  async loadLanguageFile() {
    const path = await openFile({
      directory: false,
      multiple: false,
      filters: [
        {
          name: 'Translation File',
          extensions: ['json'],
        },
      ],
    });
    if (typeof path !== 'string') return;
    let translations;
    try {
      const fileData = await readTextFile(path);
      translations = JSON.parse(fileData);
    } catch (e) {
      console.error(e);
      await message('Translations could not be loaded:\n' + e, {
        title: 'Error loading translations',
        type: 'error',
      });
      return;
    }
    this.translate.setTranslation('DEBUG', translations);
    this.setUserLanguage('DEBUG');
    await message('Translations have been loaded from ' + path, 'Translations loaded');
  }

  async printSettings() {
    console.log(
      'SETTINGS',
      await this.store.entries().then((entries) =>
        entries.reduce((acc, kv) => {
          return (acc[kv[0]] = kv[1]), acc;
        }, {} as { [s: string]: any })
      )
    );
  }

  setAskForAdminOnStart(enabled: boolean) {
    this.settingsService.updateSettings({ askForAdminOnStart: enabled });
  }

  setTelemetryEnabled(enabled: boolean) {
    this.telemetry.updateSettings({ enabled });
  }

  checkForUpdates() {}

  async updateOrCheck() {
    if (this.updateOrCheckInProgress) return;
    this.updateOrCheckInProgress = true;
    await Promise.allSettled([
      this.updateAvailable.manifest
        ? this.update.installUpdate()
        : this.update.checkForUpdate(false),
      new Promise((resolve) => setTimeout(resolve, 1000)),
    ]);
    this.updateOrCheckInProgress = false;
  }
}
