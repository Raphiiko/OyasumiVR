import { invoke } from '@tauri-apps/api/core';
import { appDataDir, join } from '@tauri-apps/api/path';
import { exists, readTextFile } from '@tauri-apps/plugin-fs';
import { debug, error, info, warn } from '@tauri-apps/plugin-log';
import { LazyStore } from '@tauri-apps/plugin-store';
import { interval } from 'rxjs';

const PROTECTOR_STORES: Record<string, StoreProtector> = {};
const SNAPSHOT_INTERVAL = 30000;

export async function serializeStoreContents(store: LazyStore): Promise<string> {
  const entries = await store.entries();
  return JSON.stringify(
    entries.reduce((acc, e) => ((acc[e[0]] = e[1]), acc), {} as Record<string, unknown>)
  );
}

export class StoreProtector {
  private lastSavedHash?: string;
  private snapshotPath?: string;
  private recoveryInitialized = false;
  private periodicSnapshotsStarted = false;

  constructor(
    private store: LazyStore,
    private storeName: string,
    private storePath: string
  ) {}

  public async initializeRecovery(restoreCorruption = true) {
    if (this.recoveryInitialized || PROTECTOR_STORES[this.storeName]) {
      return;
    }
    this.recoveryInitialized = true;
    PROTECTOR_STORES[this.storeName] = this;
    this.snapshotPath = await join(await appDataDir(), 'StoreProtector', this.storeName + '.dat');
    if (restoreCorruption && (await this.isStoreCorrupted())) {
      warn(
        "[StoreProtector] Detected possible corruption in store '" +
          this.storeName +
          "'. Attempting to restore from snapshot..."
      );
      if (!(await this.restoreSnapshot())) {
        error(
          "[StoreProtector] No viable snapshot found for store '" +
            this.storeName +
            "'. Corruption cannot be restored."
        );
      }
    }
  }

  // Requires initializeRecovery to have finished, so snapshots never race recovery
  public startPeriodicSnapshots() {
    if (this.periodicSnapshotsStarted || !this.recoveryInitialized) {
      return;
    }
    this.periodicSnapshotsStarted = true;
    interval(SNAPSHOT_INTERVAL).subscribe(() => {
      this.saveSnapshot().catch((e) =>
        error(
          "[StoreProtector] Failed to save snapshot for store '" +
            this.storeName +
            "': " +
            JSON.stringify(e)
        )
      );
    });
  }

  public async hasAvailableSnapshot(): Promise<boolean> {
    if (!this.snapshotPath) return false;
    return exists(this.snapshotPath);
  }

  public async restoreSnapshot(): Promise<boolean> {
    if (!(await this.hasAvailableSnapshot())) return false;
    info("[StoreProtector] Restoring snapshot for store '" + this.storeName + "'");
    const restored = await invoke<boolean>('store_safety_restore_snapshot', {
      storeName: this.storeName,
      storeFileName: this.storePath,
    });
    if (!restored) return false;
    await this.store.reload({ ignoreDefaults: true });
    info("[StoreProtector] Successfully restored snapshot for store '" + this.storeName + "'");
    return true;
  }

  private async isStoreCorrupted(): Promise<boolean> {
    const storePath = await join(await appDataDir(), this.storePath);
    if (!(await exists(storePath))) return false;
    try {
      const storeDataString = await readTextFile(storePath);
      const storeData = JSON.parse(storeDataString);
      return typeof storeData !== 'object';
    } catch (e) {
      error(
        "[StoreProtector] Failed to read store data for store '" +
          this.storeName +
          "': " +
          JSON.stringify(e)
      );
      return true;
    }
  }

  private async saveSnapshot() {
    if (!this.recoveryInitialized || !this.snapshotPath) return;
    const storeDataString = await serializeStoreContents(this.store);
    const storeDataHash = await this.generateHash(storeDataString);
    if ((await exists(this.snapshotPath)) && this.lastSavedHash === storeDataHash) return;
    await invoke('store_safety_save_snapshot', {
      storeName: this.storeName,
      contents: storeDataString,
    });
    this.lastSavedHash = storeDataHash;
    debug("[StoreProtector] Successfully saved snapshot for store '" + this.storeName + "'");
  }

  private async generateHash(data: string): Promise<string> {
    return Array.from(
      new Uint8Array(await crypto.subtle.digest('SHA-1', new TextEncoder().encode(data)))
    )
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }
}
