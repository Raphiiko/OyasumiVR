import { getVersion as getVersionFromTauri } from '@tauri-apps/api/app';
import { isDevMode } from '@angular/core';

export async function getVersion(): Promise<string> {
  if (isDevMode()) return '0.0.0';
  return await getVersionFromTauri();
}
