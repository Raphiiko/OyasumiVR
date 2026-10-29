import { commands } from '../bindings';
import { error } from '@tauri-apps/plugin-log';

/**
 * Returns null only when there is nothing to protect, and throws when protecting fails, so no
 * caller writes nothing over a secret it already stored.
 */
export async function protectSecret(plain: string | null | undefined): Promise<string | null> {
  if (!plain) return null;
  return await commands.protectSecret(plain);
}

/** Returns null when the stored secret cannot be read, which a different Windows account causes. */
export async function unprotectSecret(stored: string | null | undefined): Promise<string | null> {
  if (!stored) return null;
  try {
    return await commands.unprotectSecret(stored);
  } catch (cause) {
    error(`[Secrets] Could not unlock a secret: ${cause}`);
    return null;
  }
}
