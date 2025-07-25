import { CACHE_STORE } from '../globals';
import { BehaviorSubject, filter, firstValueFrom } from 'rxjs';

interface CachedValueEntry<T> {
  value: T;
  lastSet: number;
  ttl: number;
}

export class CachedValue<T> {
  lastSet = -1;
  private initialized: BehaviorSubject<boolean> = new BehaviorSubject<boolean>(false);

  static async cleanCache(includeNonExpired = false) {
    if (includeNonExpired) {
      // Clear entire cache
      await CACHE_STORE.clear();
    } else {
      // Clear expired cache entries only
      const entries: [key: string, value: CachedValueEntry<unknown>][] =
        await CACHE_STORE.entries<CachedValueEntry<unknown>>();
      for (const entry of entries) {
        const ttlExpired = entry[1].lastSet + entry[1].ttl < Date.now();
        if (ttlExpired) await CACHE_STORE.delete(entry[0]);
      }
    }
  }

  constructor(
    private value: T | undefined,
    private ttl: number,
    private persistenceKey?: string
  ) {
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
    if (this.value === undefined && this.lastSet === -1) return;
    this.value = undefined;
    this.lastSet = -1;
    await this.clearFromDisk();
  }

  get(): T | undefined {
    const ttlExpired = this.lastSet + this.ttl < Date.now();
    if (ttlExpired && this.persistenceKey) this.clear();
    return ttlExpired ? undefined : this.value;
  }

  private async saveToDisk() {
    if (!this.persistenceKey || this.value === undefined) return;
    await CACHE_STORE.set('CachedValue_' + this.persistenceKey, {
      value: this.value,
      lastSet: this.lastSet,
      ttl: this.ttl,
    })
  }

  private async clearFromDisk() {
    if (!this.persistenceKey) return;
    await CACHE_STORE.delete(this.persistenceKey)
  }

  private async loadFromDisk() {
    if (!this.persistenceKey) return;
    await CACHE_STORE.get<CachedValueEntry<T>>('CachedValue_' + this.persistenceKey).then(
      (value) => {
        if (!value) return;
        this.value = value.value;
        this.lastSet = value.lastSet;
      }
    );
  }
}
