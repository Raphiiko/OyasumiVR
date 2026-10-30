import { commands } from 'src-ui/app/bindings';
import { error } from '@tauri-apps/plugin-log';

/**
 * Returns null only when there is nothing to protect, and throws when protecting fails, so no
 * caller writes nothing over a secret it already stored.
 */
export async function protectSecret(plain: string | null | undefined): Promise<string | null> {
  if (!plain) return null;
  const result = await commands.protectSecret(plain);
  if (result.status === 'error') throw result.error;
  return result.data;
}

/** Returns null when the stored secret cannot be read, which a different Windows account causes. */
export async function unprotectSecret(stored: string | null | undefined): Promise<string | null> {
  if (!stored) return null;
  const result = await commands.unprotectSecret(stored);
  if (result.status === 'ok') return result.data;
  error(`[Secrets] Could not unlock a secret: ${result.error}`);
  return null;
}
