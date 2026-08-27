import { Injectable } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import { invoke } from '@tauri-apps/api/core';
import { LazyStore } from '@tauri-apps/plugin-store';
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

// Workaround for https://github.com/tauri-apps/plugins-workspace/issues/3085

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

const PROTECTED_STORES: Record<string, { file: string; store: LazyStore }> = {
  settings: { file: SETTINGS_FILE, store: SETTINGS_STORE },
  cache: { file: CACHE_FILE, store: CACHE_STORE },
  event_log: { file: EVENT_LOG_FILE, store: EVENT_LOG_STORE },
};

@Injectable({
  providedIn: 'root',
})
export class StoreSnapshotService {
  private protectors?: StoreProtector[];

  constructor(private translate: TranslocoService) {}

  public async init() {
    await this.initializeRecovery();
    this.enablePeriodicSnapshots();
  }

  // Restore any corrupted stores from their latest known good snapshots
  public async initializeRecovery() {
    if (!this.protectors) {
      this.protectors = Object.entries(PROTECTED_STORES).map(
        ([name, { file, store }]) => new StoreProtector(store, name, file, this.translate)
      );
    }
    await Promise.all(this.protectors.map((protector) => protector.initializeRecovery()));
  }

  // Only enable once startup recovery has finished, so snapshots never race recovery
  public enablePeriodicSnapshots() {
    this.protectors?.forEach((protector) => protector.startPeriodicSnapshots());
  }

  // Write an immutable checkpoint, verified on disk before it is reported back
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

  // Newest first; candidates are viable when contentFileExists and readCheckpoint succeeds
  public listCheckpoints(storeName: string): Promise<StoreCheckpoint[]> {
    return invoke<StoreCheckpoint[]>('store_safety_list_checkpoints', { storeName });
  }

  public readCheckpoint(storeName: string, checkpointId: string): Promise<string> {
    return invoke<string>('store_safety_read_checkpoint', { storeName, checkpointId });
  }

  // Preserve unusable live store bytes for inspection instead of deleting them
  public quarantineStore(storeName: string): Promise<string | null> {
    return invoke<string | null>('store_safety_quarantine_store', {
      storeName,
      storeFileName: this.getStoreEntry(storeName).file,
    });
  }

  // Atomically replace the physical store file, then reload the in-memory store
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
