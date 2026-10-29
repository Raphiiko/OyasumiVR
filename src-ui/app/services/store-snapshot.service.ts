import { Injectable } from '@angular/core';
import { CheckpointMetadata, commands, SnapshotData } from '../bindings';
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

export type { CheckpointMetadata as StoreCheckpoint } from '../bindings';

export interface LiveStoreRead {
  exists: boolean;
  contents: string | null;
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

  public readSnapshot(storeName: string): Promise<SnapshotData | null> {
    return commands.storeSafetyReadSnapshot(storeName);
  }

  public async createCheckpoint(
    storeName: string,
    reason: string,
    schemaVersions: Record<string, number>,
    contents?: string
  ): Promise<CheckpointMetadata> {
    const store = this.getStoreEntry(storeName).store;
    return commands.storeSafetyCreateCheckpoint(
      storeName,
      contents ?? (await serializeStoreContents(store)),
      reason,
      await getVersion(),
      schemaVersions
    );
  }

  public listCheckpoints(storeName: string): Promise<CheckpointMetadata[]> {
    return commands.storeSafetyListCheckpoints(storeName);
  }

  public readCheckpoint(storeName: string, checkpointId: string): Promise<string> {
    return commands.storeSafetyReadCheckpoint(storeName, checkpointId);
  }

  public quarantineStore(storeName: string): Promise<string | null> {
    return commands.storeSafetyQuarantineStore(storeName, this.getStoreEntry(storeName).file);
  }

  public async replaceStore(storeName: string, contents: string): Promise<void> {
    const entry = this.getStoreEntry(storeName);
    await commands.storeSafetyReplaceStore(entry.file, contents);
    await entry.store.reload({ ignoreDefaults: true });
  }

  private getStoreEntry(storeName: string): { file: string; store: LazyStore } {
    const entry = PROTECTED_STORES[storeName];
    if (!entry) throw new Error(`Unknown protected store '${storeName}'`);
    return entry;
  }
}
