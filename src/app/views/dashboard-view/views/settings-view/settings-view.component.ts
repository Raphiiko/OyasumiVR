import { Component, OnDestroy, OnInit } from '@angular/core';
import { APP_SETTINGS_DEFAULT, AppSettings } from '../../../../models/settings';
import { cloneDeep } from 'lodash';
import {
  AppSettingsService,
  SETTINGS_KEY_APP_SETTINGS,
} from '../../../../services/app-settings.service';
import { debounceTime, distinctUntilChanged, Subject, takeUntil } from 'rxjs';
import { LighthouseConsoleStatus, OpenVRService } from '../../../../services/openvr.service';
import { noop, vshrink } from '../../../../utils/animations';
import { message, open as openFile } from '@tauri-apps/api/dialog';
import { SETTINGS_KEY_AUTOMATION_CONFIGS } from '../../../../services/automation-config.service';
import { Store } from 'tauri-plugin-store-api';
import { SETTINGS_FILE } from '../../../../globals';
import { Router } from '@angular/router';
import { readTextFile } from '@tauri-apps/api/fs';
import { TranslateService } from '@ngx-translate/core';
import { LighthouseService } from '../../../../services/lighthouse.service';

@Component({
  selector: 'app-settings-view',
  templateUrl: './settings-view.component.html',
  styleUrls: ['./settings-view.component.scss'],
  animations: [vshrink(), noop()],
})
export class SettingsViewComponent implements OnInit, OnDestroy {
  storeKey = { SETTINGS_KEY_APP_SETTINGS, SETTINGS_KEY_AUTOMATION_CONFIGS };
  private store = new Store(SETTINGS_FILE);

  destroy$: Subject<void> = new Subject<void>();
  appSettings: AppSettings = cloneDeep(APP_SETTINGS_DEFAULT);
  lighthouseConsoleStatus: LighthouseConsoleStatus = 'UNKNOWN';
  lighthouseConsolePathAlert?: {
    text: string;
    type: 'INFO' | 'SUCCESS' | 'ERROR';
    loadingIndicator?: boolean;
  };
  lighthouseConsolePathInputChange: Subject<string> = new Subject();
  activeTab: 'GENERAL' | 'DEBUG' = 'GENERAL';
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

  constructor(
    private settingsService: AppSettingsService,
    public openvr: OpenVRService,
    private router: Router,
    private translate: TranslateService,
    private lighthouse: LighthouseService
  ) {}

  ngOnInit(): void {
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
}
