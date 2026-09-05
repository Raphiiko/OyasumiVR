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
      await CACHE_STORE.clear();
    } else {
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
    const finishInitialization = () => this.initialized.next(true);
    if (value !== undefined) {
      this.lastSet = Date.now();
      this.saveToDisk().then(finishInitialization, finishInitialization);
    } else if (persistenceKey) this.loadFromDisk().then(finishInitialization, finishInitialization);
    else finishInitialization();
  }

  async waitForInitialisation() {
    await firstValueFrom(this.initialized.pipe(filter(Boolean)));
  }

  async set(value: T) {
    if (!this.initialized.value) await this.waitForInitialisation();
    this.value = value;
    this.lastSet = Date.now();
    await this.saveToDisk();
  }

  async clear() {
    if (!this.initialized.value) await this.waitForInitialisation();
    if (this.value === undefined && this.lastSet === -1 && !this.persistenceKey) return;
    this.value = undefined;
    this.lastSet = -1;
    await this.clearFromDisk();
  }

  get(): T | undefined {
    if (!this.initialized.value) return undefined;
    const ttlExpired = this.lastSet !== -1 && this.lastSet + this.ttl < Date.now();
    if (ttlExpired && this.persistenceKey) void this.clear().catch(() => undefined);
    return ttlExpired ? undefined : this.value;
  }

  private async saveToDisk() {
    if (!this.persistenceKey || this.value === undefined) return;
    await CACHE_STORE.set('CachedValue_' + this.persistenceKey, {
      value: this.value,
      lastSet: this.lastSet,
      ttl: this.ttl,
    });
  }

  private async clearFromDisk() {
    if (!this.persistenceKey) return;
    await CACHE_STORE.delete('CachedValue_' + this.persistenceKey);
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
