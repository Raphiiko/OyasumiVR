import { invoke } from '@tauri-apps/api';

export async function readTextFromFile(path: string, skipLines = 0): Promise<string> {
  return invoke<string>('read_text_from_file', { path, skipLines });
}
