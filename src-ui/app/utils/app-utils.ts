import { getVersion as getVersionFromTauri } from '@tauri-apps/api/app';

export async function getVersion(): Promise<string> {
  return await getVersionFromTauri();
}
