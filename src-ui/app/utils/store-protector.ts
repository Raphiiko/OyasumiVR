//
// Utility for storing store snapshots and restoring them in case of corruption
//

import { TranslateService } from '@ngx-translate/core';
import { appDataDir, join } from '@tauri-apps/api/path';
import {
  copyFile,
  exists,
  mkdir,
  readTextFile,
  remove,
  rename,
  writeTextFile,
} from '@tauri-apps/plugin-fs';
import { debug, error, info, warn } from '@tauri-apps/plugin-log';
import { LazyStore } from '@tauri-apps/plugin-store';
import { interval } from 'rxjs';

const PROTECTOR_STORES: Record<string, StoreProtector> = {};
const SNAPSHOT_INTERVAL = 30000;

export class StoreProtector {
  private lastSavedHash?: string;
  private enabled = false;
  private basePath?: string;

  constructor(
    private store: LazyStore,
    private storeName: string,
    private storePath: string,
    private translate: TranslateService
  ) {}

  public async init() {
    if (this.enabled || PROTECTOR_STORES[this.storeName]) {
      return;
    }
    this.enabled = true;
    PROTECTOR_STORES[this.storeName] = this;
    this.basePath = await join(await appDataDir(), 'StoreProtector');
    await mkdir(this.basePath!, { recursive: true });
    if (await this.isStoreCorrupted()) {
      warn(
        "[StoreProtector] Detected possible corruption in store '" +
          this.storeName +
          "'. Attempting to restore from snapshot..."
      );
      if (!(await this.restoreSnapshot())) {
        error(
          "[StoreProtector] No available snapshot found for store '" +
            this.storeName +
            "'. Corruption cannot be restored."
        );
      }
    }
    interval(SNAPSHOT_INTERVAL).subscribe(() => this.saveSnapshot());
  }

  public async hasAvailableSnapshot(): Promise<boolean> {
    return exists(await join(this.basePath!, this.storeName + '.dat'));
  }

  public async restoreSnapshot(): Promise<boolean> {
    const snapshotPath = await join(this.basePath!, this.storeName + '.dat');
    if (!(await exists(snapshotPath))) return false;
    info("[StoreProtector] Restoring snapshot for store '" + this.storeName + "'");
    await copyFile(snapshotPath, await join(await appDataDir(), this.storePath));
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

    return false;
  }

  private async saveSnapshot() {
    if (!this.enabled) return;
    // Obtain the store data
    const storeData = await this.store
      .entries()
      .then((entries) =>
        entries.reduce((acc, e) => ((acc[e[0]] = e[1]), acc), {} as Record<string, unknown>)
      );
    const storeDataString = JSON.stringify(storeData);
    const finalPath = await join(this.basePath!, this.storeName + '.dat');
    // Calculate a hash for the store data
    const storeDataHash = await this.generateHash(storeDataString);
    // If we wrote the same data last time, no need to save again
    if ((await exists(finalPath)) && this.lastSavedHash === storeDataHash) return;
    // Save the snapshot data to a temporary file
    const preValidationPath = await join(this.basePath!, this.storeName + '.pre.dat');
    await writeTextFile(preValidationPath, storeDataString);
    // Read the pre-validation data and compare it to the current data
    try {
      const preValidationData = await readTextFile(preValidationPath);
      if (preValidationData !== storeDataString) {
        throw new Error('Pre-validation data does not match current data');
      }
    } catch (e) {
      error("Failed to save snapshot for store '" + this.storeName + "': " + JSON.stringify(e));
      await remove(preValidationPath);
      return;
    }
    // Move the temporary file to the final file
    await rename(preValidationPath, finalPath);
    // Update the last saved hash
    this.lastSavedHash = storeDataHash;
    // Log the success
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
