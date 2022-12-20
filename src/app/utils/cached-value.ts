import { CACHE_FILE } from '../globals';
import { Store } from 'tauri-plugin-store-api';
import { BehaviorSubject, filter, firstValueFrom } from 'rxjs';

interface CachedValueEntry<T> {
  value: T;
  lastSet: number;
  ttl: number;
}

export class CachedValue<T> {
  private static store = new Store(CACHE_FILE);
  lastSet: number = -1;
  private initialized: BehaviorSubject<boolean> = new BehaviorSubject<boolean>(false);

  static async cleanCache(includeNonExpired = false) {
    if (includeNonExpired) {
      // Clear entire cache
      await CachedValue.store.clear();
    } else {
      // Clear expired cache entries only
      const entries: [key: string, value: CachedValueEntry<unknown>][] =
        await CachedValue.store.entries<CachedValueEntry<unknown>>();
      for (let entry of entries) {
        const ttlExpired = entry[1].lastSet + entry[1].ttl < Date.now();
        if (ttlExpired) await CachedValue.store.delete(entry[0]);
      }
    }
    await CachedValue.store.save();
  }

  constructor(private value: T | undefined, private ttl: number, private persistenceKey?: string) {
    if (value !== undefined) this.set(value).then(() => this.initialized.next(true));
    else if (persistenceKey) this.loadFromDisk().then(() => this.initialized.next(true));
  }

  async waitForInitialisation() {
    await firstValueFrom(this.initialized.pipe(filter(Boolean)));
  }

  async set(value: T) {
    this.value = value;
    this.lastSet = Date.now();
    await this.saveToDisk();
  }

  async clear() {
    this.value = undefined;
    this.lastSet = -1;
    await this.clearFromDisk();
  }

  get(): T | undefined {
    const ttlExpired = this.lastSet + this.ttl < Date.now();
    if (ttlExpired && this.persistenceKey) this.clearFromDisk();
    return ttlExpired ? undefined : this.value;
  }

  private async saveToDisk() {
    if (!this.persistenceKey || this.value === undefined) return;
    await CachedValue.store
      .set('CachedValue_' + this.persistenceKey, {
        value: this.value,
        lastSet: this.lastSet,
        ttl: this.ttl,
      })
      .then(() => CachedValue.store.save());
  }

  private async clearFromDisk() {
    if (!this.persistenceKey) return;
    await CachedValue.store.delete(this.persistenceKey).then(() => CachedValue.store.save());
  }

  private async loadFromDisk() {
    if (!this.persistenceKey) return;
    await CachedValue.store
      .get<CachedValueEntry<T>>('CachedValue_' + this.persistenceKey)
      .then((value) => {
        if (value === null) return;
        this.value = value.value;
        this.lastSet = value.lastSet;
      });
  }
}
