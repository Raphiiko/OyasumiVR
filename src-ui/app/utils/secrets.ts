import { invoke } from '@tauri-apps/api/core';
import { error } from '@tauri-apps/plugin-log';

export async function protectSecret(secret: string): Promise<string> {
  return await invoke<string>('protect_secret', { secret });
}

export async function unprotectSecret(secret: string): Promise<string> {
  return await invoke<string>('unprotect_secret', { secret });
}

/**
 * Holds one secret that is protected on disk and plain in memory.
 * Both methods return the value to store, and keep the stored value whenever protecting or
 * unprotecting fails.
 */
export class ProtectedSecret {
  private stored: string | null = null;
  private plain: string | null = null;
  private locked = false;

  constructor(private label: string) {}

  /** Returns the plain value, or null when it cannot be read. */
  async load(stored: string | null | undefined): Promise<string | null> {
    this.stored = stored ?? null;
    this.plain = null;
    this.locked = false;
    if (!this.stored) return null;
    try {
      this.plain = await unprotectSecret(this.stored);
    } catch (cause) {
      error(`${this.label} could not be unlocked: ${cause}`);
      this.locked = true;
    }
    return this.plain;
  }

  /** Returns the value to write, which is unchanged while the plain value is unchanged. */
  async store(plain: string | null | undefined): Promise<string | null> {
    if (!plain) {
      if (!this.locked) {
        this.stored = null;
        this.plain = null;
      }
      return this.stored;
    }
    if (plain === this.plain) return this.stored;
    try {
      this.stored = await protectSecret(plain);
      this.plain = plain;
      this.locked = false;
    } catch (cause) {
      error(`${this.label} could not be protected: ${cause}`);
    }
    return this.stored;
  }
}
