import { LazyStore } from '@tauri-apps/plugin-store';

export class GuardedSettingsStore extends LazyStore {
  private writesBlocked = false;
  private writeQueue: Promise<unknown> = Promise.resolve();

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.writeQueue.then(operation, operation);
    this.writeQueue = result.catch(() => undefined);
    return result;
  }

  // A cleared key must stay cleared until relaunch, so no stale in-memory owner can rewrite it.
  override async set(key: string, value: unknown): Promise<void> {
    await this.enqueue(async () => {
      if (this.writesBlocked) return;
      await super.set(key, value);
    });
  }

  override async delete(key: string): Promise<boolean> {
    return this.enqueue(async () => {
      this.writesBlocked = true;
      const deleted = await super.delete(key);
      await super.save();
      return deleted;
    });
  }

  override async clear(): Promise<void> {
    await this.enqueue(async () => {
      this.writesBlocked = true;
      await super.clear();
      await super.save();
    });
  }

  async deleteAll(keys: Array<string>): Promise<void> {
    await this.enqueue(async () => {
      this.writesBlocked = true;
      const results = await Promise.allSettled(keys.map((key) => super.delete(key)));
      await super.save();
      const failures = results.filter((result) => result.status === 'rejected');
      if (failures.length > 0) {
        throw (failures[0] as PromiseRejectedResult).reason;
      }
    });
  }
}
