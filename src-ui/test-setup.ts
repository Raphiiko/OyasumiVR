import '@angular/compiler';
import { beforeEach, vi } from 'vitest';
import { fakeTauri } from './testing/fake-tauri';

// The legacy storage crypto reads window.crypto and window.atob
if (!(globalThis as any).window) (globalThis as any).window = globalThis;

vi.mock('@tauri-apps/api/core', () => ({
  invoke: async (command: string, args: Record<string, string>) => {
    if (command === 'protect_secret') return fakeTauri.protect(args['secret']);
    if (command === 'unprotect_secret') return fakeTauri.unprotect(args['secret']);
    throw new Error(`Unexpected command: ${command}`);
  },
}));

vi.mock('@tauri-apps/plugin-log', () => {
  const record = (line: string) => {
    fakeTauri.logs.push(line);
  };
  return { error: record, warn: record, info: record, debug: record, trace: record };
});

vi.mock('@tauri-apps/plugin-fs', () => ({
  BaseDirectory: { AppData: 'AppData' },
  writeTextFile: async (path: string, contents: string) => {
    fakeTauri.backups.push({ path, contents });
  },
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({
  message: async (text: string) => {
    fakeTauri.dialogs.push(text);
  },
}));

beforeEach(() => fakeTauri.reset());
