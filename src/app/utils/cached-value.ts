import { CACHE_FILE } from '../globals';
import { Store } from 'tauri-plugin-store-api';

export class CachedValue<T> {
  private store = new Store(CACHE_FILE);
  lastSet: number = -1;

  constructor(private value: T | undefined, private ttl: number, private persistenceKey?: string) {
    if (value !== undefined) this.set(value);
    else if (persistenceKey) this.loadFromDisk();
  }

  set(value: T) {
    this.value = value;
    this.lastSet = Date.now();
    this.saveToDisk();
  }

  clear() {
    this.value = undefined;
    this.lastSet = -1;
    this.clearFromDisk();
  }

  get(): T | undefined {
    const ttlExpired = this.lastSet + this.ttl < Date.now();
    if (ttlExpired && this.persistenceKey) this.clearFromDisk();
    return ttlExpired ? undefined : this.value;
  }

  private saveToDisk() {
    if (!this.persistenceKey || this.value === undefined) return;
    this.store
      .set('CachedValue_' + this.persistenceKey, {
        value: this.value,
        lastSet: this.lastSet,
        ttl: this.ttl,
      })
      .then(() => this.store.save());
  }

  private clearFromDisk() {
    if (!this.persistenceKey) return;
    this.store.delete(this.persistenceKey).then(() => this.store.save());
  }

  private loadFromDisk() {
    if (!this.persistenceKey) return;
    this.store
      .get<{ value: T; lastSet: number; ttl: number }>('CachedValue_' + this.persistenceKey)
      .then((value) => {
        if (value === null) return;
        this.value = value.value;
        this.lastSet = value.lastSet;
      });
  }
}
