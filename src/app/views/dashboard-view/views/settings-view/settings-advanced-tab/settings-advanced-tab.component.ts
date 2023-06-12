import { Component, OnInit } from '@angular/core';
import { AppSettingsService } from '../../../../../services/app-settings.service';
import { SettingsTabComponent } from '../settings-tab/settings-tab.component';
import { message, open as openFile } from '@tauri-apps/api/dialog';
import { readTextFile } from '@tauri-apps/api/fs';
import {
  CACHE_FILE,
  SETTINGS_FILE,
  SETTINGS_KEY_APP_SETTINGS,
  SETTINGS_KEY_AUTOMATION_CONFIGS,
  SETTINGS_KEY_SLEEP_MODE,
  SETTINGS_KEY_TELEMETRY_SETTINGS,
  SETTINGS_KEY_THEMING_SETTINGS,
  SETTINGS_KEY_VRCHAT_API,
} from '../../../../../globals';
import { Store } from 'tauri-plugin-store-api';
import { Router } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import { error, info } from 'tauri-plugin-log-api';
import { ConfirmModalComponent } from '../../../../../components/confirm-modal/confirm-modal.component';
import { ModalService } from 'src/app/services/modal.service';
import { invoke } from '@tauri-apps/api';
import { relaunch } from '@tauri-apps/api/process';
import { EventLogService } from '../../../../../services/event-log.service';
import { appLogDir } from '@tauri-apps/api/path';

@Component({
  selector: 'app-settings-advanced-tab',
  templateUrl: './settings-advanced-tab.component.html',
  styleUrls: ['./settings-advanced-tab.component.scss'],
  animations: [],
})
export class SettingsAdvancedTabComponent extends SettingsTabComponent implements OnInit {
  private settingsStore = new Store(SETTINGS_FILE);
  private cacheStore = new Store(CACHE_FILE);
  persistentStorageItems: Array<{
    key: string;
  }> = [
    { key: 'appSettings' },
    { key: 'automationSettings' },
    { key: 'vrcData' },
    { key: 'appCache' },
    { key: 'imageCache' },
    { key: 'eventLog' },
    { key: 'logs' },
    { key: 'miscData' },
  ];
  checkedPersistentStorageItems: string[] = [];

  constructor(
    settingsService: AppSettingsService,
    private router: Router,
    private translate: TranslateService,
    private modalService: ModalService,
    private eventLogService: EventLogService
  ) {
    super(settingsService);
  }

  override async ngOnInit() {
    super.ngOnInit();
  }

  isPersistentStorageItemChecked(key: string) {
    if (key === 'ALL') {
      return this.persistentStorageItems.every((item) =>
        this.checkedPersistentStorageItems.includes(item.key)
      );
    }
    return this.checkedPersistentStorageItems.includes(key);
  }

  togglePersistentStorageItem(key: string) {
    if (key === 'ALL') {
      if (this.isPersistentStorageItemChecked('ALL')) {
        this.checkedPersistentStorageItems = [];
      } else {
        this.checkedPersistentStorageItems = this.persistentStorageItems.map((item) => item.key);
      }
    } else {
      if (this.isPersistentStorageItemChecked(key)) {
        this.checkedPersistentStorageItems = this.checkedPersistentStorageItems.filter(
          (item) => item !== key
        );
      } else {
        this.checkedPersistentStorageItems.push(key);
      }
    }
  }

  async clearStore(storeType: 'SETTINGS' | 'CACHE', key?: string) {
    const store = storeType === 'SETTINGS' ? this.settingsStore : this.cacheStore;
    if (!key) {
      await store.clear();
    } else {
      await store.delete(key);
    }
    await store.save();
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
      error(`[DebugSettings] Could not load translations from file: ${JSON.stringify(e)}`);
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

  clearPersistentStorage() {
    this.modalService
      .addModal(ConfirmModalComponent, {
        title: 'settings.advanced.persistentData.clearModal.title',
        message: {
          string: 'settings.advanced.persistentData.clearModal.message',
          values: {
            items: this.checkedPersistentStorageItems
              .map(
                (item) =>
                  ' • ' +
                  this.translate.instant(`settings.advanced.persistentData.dataType.${item}.title`)
              )
              .join('\n'),
          },
        },
      })
      .subscribe(async (data) => {
        if (!data.confirmed) return;
        info('[Settings] User triggered clearing of persistent storage');
        let askForRelaunch = false;
        await Promise.all(
          this.checkedPersistentStorageItems.map(async (item) => {
            switch (item) {
              case 'appSettings':
                info('[Settings] Clearing app settings');
                await this.settingsStore.delete(SETTINGS_KEY_APP_SETTINGS);
                askForRelaunch = true;
                break;
              case 'automationSettings':
                info('[Settings] Clearing automation settings');
                await this.settingsStore.delete(SETTINGS_KEY_AUTOMATION_CONFIGS);
                await this.settingsStore.delete(SETTINGS_KEY_SLEEP_MODE);
                askForRelaunch = true;
                break;
              case 'vrcData':
                info('[Settings] Clearing VRChat data');
                await this.settingsStore.delete(SETTINGS_KEY_VRCHAT_API);
                askForRelaunch = true;
                break;
              case 'appCache':
                info('[Settings] Clearing application cache');
                await this.cacheStore.clear();
                askForRelaunch = true;
                break;
              case 'imageCache':
                info('[Settings] Clearing image cache');
                await invoke('clean_image_cache', { onlyExpired: false });
                break;
              case 'miscData':
                info('[Settings] Clearing misc data');
                await this.settingsStore.delete(SETTINGS_KEY_THEMING_SETTINGS);
                await this.settingsStore.delete(SETTINGS_KEY_TELEMETRY_SETTINGS);
                break;
              case 'logs':
                info('[Settings] Clearing log files');
                await invoke('clean_log_files');
                break;
              case 'eventLog':
                info('[Settings] Clearing event log');
                await this.eventLogService.clearLog();
                break;
            }
          })
        );
        await this.settingsStore.save();
        await this.cacheStore.save();
        info('[Settings] Finished clearing of persistent storage');
        this.checkedPersistentStorageItems = [];
        if (askForRelaunch) {
          this.modalService
            .addModal(ConfirmModalComponent, {
              title: 'settings.advanced.persistentData.relaunchModal.title',
              message: 'settings.advanced.persistentData.relaunchModal.message',
              confirmButtonText: 'settings.advanced.persistentData.relaunchModal.relaunch',
              cancelButtonText: 'settings.advanced.persistentData.relaunchModal.later',
            })
            .subscribe(async (data) => {
              if (!data.confirmed) return;
              await relaunch();
            });
        }
      });
  }

  async openLogsFolder() {
    await invoke('show_in_folder', {
      path: await appLogDir().then((dir) => dir + 'OyasumiVR.log'),
    });
  }
}
