import { LazyStore } from '@tauri-apps/plugin-store';

export class GuardedSettingsStore extends LazyStore {
  private writesBlocked = false;

  // A cleared key must stay cleared until relaunch, so no stale in-memory owner can rewrite it.
  override async set(key: string, value: unknown): Promise<void> {
    if (this.writesBlocked) return;
    await super.set(key, value);
  }

  override async delete(key: string): Promise<boolean> {
    this.writesBlocked = true;
    return super.delete(key);
  }

  override async clear(): Promise<void> {
    this.writesBlocked = true;
    await super.clear();
  }
}
