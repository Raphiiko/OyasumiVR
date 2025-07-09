import { Component } from '@angular/core';
import { message, open as openFile } from '@tauri-apps/plugin-dialog';
import { readTextFile } from '@tauri-apps/plugin-fs';
import {
  CACHE_STORE,
  SETTINGS_KEY_APP_SETTINGS,
  SETTINGS_KEY_AUTOMATION_CONFIGS,
  SETTINGS_KEY_PULSOID_API,
  SETTINGS_KEY_SLEEP_MODE,
  SETTINGS_KEY_TELEMETRY_SETTINGS,
  SETTINGS_KEY_THEMING_SETTINGS,
  SETTINGS_KEY_VRCHAT_API,
  SETTINGS_STORE,
} from '../../../../globals';
import { Router } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';
import { error, info } from '@tauri-apps/plugin-log';
import {
  ConfirmModalComponent,
  ConfirmModalInputModel,
  ConfirmModalOutputModel,
} from '../../../../components/confirm-modal/confirm-modal.component';
import { ModalService } from 'src-ui/app/services/modal.service';
import { invoke } from '@tauri-apps/api/core';
import { relaunch } from '@tauri-apps/plugin-process';
import { EventLogService } from '../../../../services/event-log.service';
import { appLogDir } from '@tauri-apps/api/path';
import { IPCService } from '../../../../services/ipc.service';
import { SetDebugTranslationsRequest } from '../../../../../../src-grpc-web-client/overlay-sidecar_pb';
import { OpenVRService } from 'src-ui/app/services/openvr.service';
import { AppSettingsService } from '../../../../services/app-settings.service';
import { FLAVOUR } from '../../../../../build';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { firstValueFrom } from 'rxjs';

@Component({
  selector: 'app-settings-advanced-view',
  templateUrl: './settings-advanced-view.component.html',
  styleUrls: ['./settings-advanced-view.component.scss'],
  animations: [],
  standalone: false,
})
export class SettingsAdvancedViewComponent {
  persistentStorageItems: Array<{
    key: string;
  }> = [
    { key: 'appSettings' },
    { key: 'automationSettings' },
    { key: 'vrcData' },
    { key: 'integrations' },
    { key: 'appCache' },
    { key: 'imageCache' },
    { key: 'eventLog' },
    { key: 'logs' },
    { key: 'miscData' },
  ];
  checkedPersistentStorageItems: string[] = [];
  memoryWatcherActive = FLAVOUR === 'DEV';
  oscServerEnabled = true;
  overlayGpuAcceleration = true;
  openVrInitDelayFix = false;

  constructor(
    private router: Router,
    private translate: TranslateService,
    private modalService: ModalService,
    private eventLogService: EventLogService,
    private ipcService: IPCService,
    protected openvr: OpenVRService,
    private settingsService: AppSettingsService
  ) {
    this.settingsService.settings.pipe(takeUntilDestroyed()).subscribe((settings) => {
      this.oscServerEnabled = settings.oscServerEnabled;
      this.overlayGpuAcceleration = settings.overlayGpuAcceleration;
      this.openVrInitDelayFix = settings.openVrInitDelayFix;
    });
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
    const store = storeType === 'SETTINGS' ? SETTINGS_STORE : CACHE_STORE;
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
        kind: 'error',
      });
      return;
    }
    // Set translations in overlay sidecar
    const client = await firstValueFrom(this.ipcService.overlaySidecarClient);
    if (client) {
      await client.setDebugTranslations({
        translations: JSON.stringify(translations),
      } as SetDebugTranslationsRequest);
    }
    // Set translations in main application
    this.translate.setTranslation('DEBUG', translations);
    // Switch language to DEBUG
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
        if (!data?.confirmed) return;
        info('[Settings] User triggered clearing of persistent storage');
        let askForRelaunch = false;
        await Promise.all(
          this.checkedPersistentStorageItems.map(async (item) => {
            switch (item) {
              case 'appSettings':
                info('[Settings] Clearing app settings');
                await SETTINGS_STORE.delete(SETTINGS_KEY_APP_SETTINGS);
                askForRelaunch = true;
                break;
              case 'automationSettings':
                info('[Settings] Clearing automation settings');
                await SETTINGS_STORE.delete(SETTINGS_KEY_AUTOMATION_CONFIGS);
                await SETTINGS_STORE.delete(SETTINGS_KEY_SLEEP_MODE);
                askForRelaunch = true;
                break;
              case 'vrcData':
                info('[Settings] Clearing VRChat data');
                await SETTINGS_STORE.delete(SETTINGS_KEY_VRCHAT_API);
                askForRelaunch = true;
                break;
              case 'integrations':
                info('[Settings] Clearing integration data');
                await SETTINGS_STORE.delete(SETTINGS_KEY_PULSOID_API);
                askForRelaunch = true;
                break;
              case 'appCache':
                info('[Settings] Clearing application cache');
                await CACHE_STORE.clear();
                askForRelaunch = true;
                break;
              case 'imageCache':
                info('[Settings] Clearing image cache');
                await invoke('clean_image_cache', { onlyExpired: false });
                break;
              case 'miscData':
                info('[Settings] Clearing misc data');
                await SETTINGS_STORE.delete(SETTINGS_KEY_THEMING_SETTINGS);
                await SETTINGS_STORE.delete(SETTINGS_KEY_TELEMETRY_SETTINGS);
                break;
              case 'logs':
                info('[Settings] Clearing log files');
                await invoke('clear_log_files');
                break;
              case 'eventLog':
                info('[Settings] Clearing event log');
                await this.eventLogService.clearLog();
                break;
            }
          })
        );
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
              if (!data?.confirmed) return;
              await relaunch();
            });
        }
      });
  }

  async openLogsFolder() {
    const path = await appLogDir().then((dir) => dir + '\\OyasumiVR.log');
    await invoke('show_in_folder', { path });
  }

  async reregisterVRManifest() {
    if ((await firstValueFrom(this.openvr.status)) !== 'INITIALIZED') return;
    try {
      await invoke('openvr_reregister_manifest');
    } catch (e) {
      error(`[Settings] Could not re-register VR manifest: ${JSON.stringify(e)}`);
      switch (e) {
        case 'MANIFEST_ADD_FAILED':
        case 'MANIFEST_REMOVE_FAILED':
        case 'MANIFEST_CHECK_FAILED':
        case 'MANIFEST_NOT_REGISTERED':
        case 'FLAVOUR_NOT_ELIGIBLE':
          this.modalService
            .addModal<ConfirmModalInputModel, ConfirmModalOutputModel>(ConfirmModalComponent, {
              title: `settings.advanced.fixes.vrManifestReregister.modal.${e}.title`,
              message: `settings.advanced.fixes.vrManifestReregister.modal.${e}.message`,
              showCancel: false,
            })
            .subscribe();
          break;
        default:
          this.modalService
            .addModal<ConfirmModalInputModel, ConfirmModalOutputModel>(ConfirmModalComponent, {
              title: `settings.advanced.fixes.vrManifestReregister.modal.UNKNOWN.title`,
              message: `settings.advanced.fixes.vrManifestReregister.modal.UNKNOWN.message`,
              showCancel: false,
            })
            .subscribe();
          break;
      }
      return;
    }
    this.modalService
      .addModal<ConfirmModalInputModel, ConfirmModalOutputModel>(ConfirmModalComponent, {
        title: 'settings.advanced.fixes.vrManifestReregister.modal.success.title',
        message: 'settings.advanced.fixes.vrManifestReregister.modal.success.message',
        showCancel: false,
      })
      .subscribe();
  }

  async openDevTools() {
    await invoke('open_dev_tools');
  }

  setOscServerEnabled(enabled: boolean) {
    this.settingsService.updateSettings({
      oscServerEnabled: enabled,
    });
  }

  setOverlayGpuAcceleration(enabled: boolean) {
    this.settingsService.updateSettings({ overlayGpuAcceleration: enabled });
  }

  setOpenVrInitDelayFix(enabled: boolean) {
    this.settingsService.updateSettings({ openVrInitDelayFix: enabled });
  }
}
