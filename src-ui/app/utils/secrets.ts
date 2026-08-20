import { invoke } from '@tauri-apps/api/core';

export async function protectSecret(secret: string): Promise<string> {
  return await invoke<string>('protect_secret', { secret });
}

export async function unprotectSecret(secret: string): Promise<string> {
  return await invoke<string>('unprotect_secret', { secret });
}
