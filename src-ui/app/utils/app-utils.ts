import { getVersion as getVersionFromTauri } from '@tauri-apps/api/app';
import { isDevMode } from '@angular/core';

export async function getVersion(forceSemver = false): Promise<string> {
  if (isDevMode()) return forceSemver ? '0.0.0' : 'DEV';
  const version = await getVersionFromTauri();
  if (version === '0.0.0') return forceSemver ? '0.0.0' : 'DEV';
  return version;
}
