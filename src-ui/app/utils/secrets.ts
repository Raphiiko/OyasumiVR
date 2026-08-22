import { invoke } from '@tauri-apps/api/core';
import { error } from '@tauri-apps/plugin-log';

/** Returns null when the secret cannot be protected, so nothing is ever stored in plain text. */
export async function protectSecret(plain: string | null | undefined): Promise<string | null> {
  if (!plain) return null;
  try {
    return await invoke<string>('protect_secret', { secret: plain });
  } catch (cause) {
    error(`[Secrets] Could not protect a secret: ${cause}`);
    return null;
  }
}

/** Returns null when the stored secret cannot be read, which a different Windows account causes. */
export async function unprotectSecret(stored: string | null | undefined): Promise<string | null> {
  if (!stored) return null;
  try {
    return await invoke<string>('unprotect_secret', { secret: stored });
  } catch (cause) {
    error(`[Secrets] Could not unlock a secret: ${cause}`);
    return null;
  }
}
