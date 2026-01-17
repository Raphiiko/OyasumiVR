import { Injectable } from '@angular/core';
import {
  EVENT_LOG_STORE,
  CACHE_FILE,
  CACHE_STORE,
  SETTINGS_FILE,
  SETTINGS_STORE,
  EVENT_LOG_FILE,
} from '../globals';
import { StoreProtector } from '../utils/store-protector';
import { TranslateService } from '@ngx-translate/core';

// Workaround for https://github.com/tauri-apps/plugins-workspace/issues/3085

@Injectable({
  providedIn: 'root',
})
export class StoreSnapshotService {
  constructor(private translate: TranslateService) {}

  public async init() {
    const settingsStoreProtector = new StoreProtector(
      SETTINGS_STORE,
      'settings',
      SETTINGS_FILE,
      this.translate
    );
    const cacheStoreProtector = new StoreProtector(
      CACHE_STORE,
      'cache',
      CACHE_FILE,
      this.translate
    );
    const eventLogStoreProtector = new StoreProtector(
      EVENT_LOG_STORE,
      'event_log',
      EVENT_LOG_FILE,
      this.translate
    );
    await Promise.all([
      settingsStoreProtector.init(),
      cacheStoreProtector.init(),
      eventLogStoreProtector.init(),
    ]);
  }
}
