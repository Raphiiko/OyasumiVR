import { Injectable } from '@angular/core';
import { invoke } from '@tauri-apps/api/core';
import { LazyStore } from '@tauri-apps/plugin-store';
import { appDataDir, join } from '@tauri-apps/api/path';
import { exists, readTextFile } from '@tauri-apps/plugin-fs';
import { error } from '@tauri-apps/plugin-log';
import {
  EVENT_LOG_STORE,
  CACHE_FILE,
  CACHE_STORE,
  SETTINGS_FILE,
  SETTINGS_STORE,
  EVENT_LOG_FILE,
} from '../globals';
import { getVersion } from '../utils/app-utils';
import { serializeStoreContents, StoreProtector } from '../utils/store-protector';

export interface StoreCheckpoint {
  formatVersion: number;
  id: string;
  storeName: string;
  appVersion: string;
  reason: string;
  createdAt: string;
  createdAtMillis: number;
  sequence: number;
  schemaVersions: Record<string, number>;
  contentChecksum: string;
  contentSizeBytes: number;
  contentFile: string;
  contentFileExists: boolean;
}

export interface LiveStoreRead {
  exists: boolean;
  contents: string | null;
}

export interface StoreSnapshot {
  contents: string;
  modifiedAtMillis: number;
}

const PROTECTED_STORES: Record<string, { file: string; store: LazyStore }> = {
  settings: { file: SETTINGS_FILE, store: SETTINGS_STORE },
  cache: { file: CACHE_FILE, store: CACHE_STORE },
  event_log: { file: EVENT_LOG_FILE, store: EVENT_LOG_STORE },
};

@Injectable({
  providedIn: 'root',
})
export class StoreSnapshotService {
  private protectors?: Record<string, StoreProtector>;

  public async initializeRecovery() {
    if (!this.protectors) {
      this.protectors = Object.fromEntries(
        Object.entries(PROTECTED_STORES).map(([name, { file, store }]) => [
          name,
          new StoreProtector(store, name, file),
        ])
      );
    }
    await Promise.all(
      Object.entries(this.protectors).map(([name, protector]) =>
        protector.initializeRecovery(name === 'cache')
      )
    );
  }

  // startup recovery must finish before snapshots can write
  public enablePeriodicSnapshots() {
    Object.values(this.protectors ?? {}).forEach((protector) => protector.startPeriodicSnapshots());
  }

  public async readLiveStore(storeName: string): Promise<LiveStoreRead> {
    const path = await join(await appDataDir(), this.getStoreEntry(storeName).file);
    if (!(await exists(path))) return { exists: false, contents: null };
    try {
      return { exists: true, contents: await readTextFile(path) };
    } catch (e) {
      error(`[StoreSnapshot] Failed to read the live store '${storeName}': ${e}`);
      return { exists: true, contents: null };
    }
  }

  public readSnapshot(storeName: string): Promise<StoreSnapshot | null> {
    return invoke<StoreSnapshot | null>('store_safety_read_snapshot', { storeName });
  }

  public async createCheckpoint(
    storeName: string,
    reason: string,
    schemaVersions: Record<string, number>,
    contents?: string
  ): Promise<StoreCheckpoint> {
    const store = this.getStoreEntry(storeName).store;
    return invoke<StoreCheckpoint>('store_safety_create_checkpoint', {
      storeName,
      contents: contents ?? (await serializeStoreContents(store)),
      reason,
      appVersion: await getVersion(),
      schemaVersions,
    });
  }

  public listCheckpoints(storeName: string): Promise<StoreCheckpoint[]> {
    return invoke<StoreCheckpoint[]>('store_safety_list_checkpoints', { storeName });
  }

  public readCheckpoint(storeName: string, checkpointId: string): Promise<string> {
    return invoke<string>('store_safety_read_checkpoint', { storeName, checkpointId });
  }

  public quarantineStore(storeName: string): Promise<string | null> {
    return invoke<string | null>('store_safety_quarantine_store', {
      storeName,
      storeFileName: this.getStoreEntry(storeName).file,
    });
  }

  public async replaceStore(storeName: string, contents: string): Promise<void> {
    const entry = this.getStoreEntry(storeName);
    await invoke('store_safety_replace_store', {
      storeFileName: entry.file,
      contents,
    });
    await entry.store.reload({ ignoreDefaults: true });
  }

  private getStoreEntry(storeName: string): { file: string; store: LazyStore } {
    const entry = PROTECTED_STORES[storeName];
    if (!entry) throw new Error(`Unknown protected store '${storeName}'`);
    return entry;
  }
}
