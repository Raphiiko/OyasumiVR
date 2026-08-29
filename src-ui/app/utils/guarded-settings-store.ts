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
      return super.delete(key);
    });
  }

  override async clear(): Promise<void> {
    await this.enqueue(async () => {
      this.writesBlocked = true;
      await super.clear();
    });
  }
}
