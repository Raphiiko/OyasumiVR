import { Component } from '@angular/core';
import {
  AppSettingsService,
  SETTINGS_KEY_APP_SETTINGS,
} from '../../../../../services/app-settings.service';
import { SettingsTabComponent } from '../settings-tab/settings-tab.component';
import { message, open as openFile } from '@tauri-apps/api/dialog';
import { readTextFile } from '@tauri-apps/api/fs';
import { SETTINGS_FILE } from '../../../../../globals';
import { Store } from 'tauri-plugin-store-api';
import { SETTINGS_KEY_AUTOMATION_CONFIGS } from '../../../../../services/automation-config.service';
import { Router } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';

@Component({
  selector: 'app-settings-debug-tab',
  templateUrl: './settings-debug-tab.component.html',
  styleUrls: ['./settings-debug-tab.component.scss'],
  animations: [],
})
export class SettingsDebugTabComponent extends SettingsTabComponent {
  storeKey = { SETTINGS_KEY_APP_SETTINGS, SETTINGS_KEY_AUTOMATION_CONFIGS };
  private store = new Store(SETTINGS_FILE);

  constructor(
    settingsService: AppSettingsService,
    private router: Router,
    private translate: TranslateService
  ) {
    super(settingsService);
  }

  override async ngOnInit() {
    super.ngOnInit();
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
