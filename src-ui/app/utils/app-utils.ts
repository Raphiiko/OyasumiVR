import { getVersion as getVersionFromTauri } from '@tauri-apps/api/app';
import { isDevMode } from '@angular/core';

export async function getVersion(): Promise<string> {
  return await getVersionFromTauri();
}
