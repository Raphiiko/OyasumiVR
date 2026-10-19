import '@angular/compiler';
import { Injector, runInInjectionContext } from '@angular/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ShowInFolderService } from './show-in-folder.service';
import { ToastService } from './toast.service';

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
vi.mock('@tauri-apps/api/path', () => ({ appLogDir: async () => 'C:\\logs' }));

function setup() {
  const show = vi.fn();
  const injector = Injector.create({ providers: [{ provide: ToastService, useValue: { show } }] });
  const service = runInInjectionContext(injector, () => new ShowInFolderService());
  return { service, show };
}

afterEach(() => {
  vi.resetAllMocks();
});

describe('ShowInFolderService', () => {
  it('selects the log file in Explorer and shows a toast', async () => {
    const h = setup();
    await h.service.showLogFile();
    expect(invoke).toHaveBeenCalledWith('show_in_folder', { path: 'C:\\logs\\OyasumiVR.log' });
    expect(h.show).toHaveBeenCalledWith({ title: 'toasts.showInFolder.opened' });
  });

  it('shows no toast when Explorer does not open', async () => {
    const h = setup();
    invoke.mockRejectedValueOnce('failed');
    await expect(h.service.show('C:\\file.txt')).rejects.toBe('failed');
    expect(h.show).not.toHaveBeenCalled();
  });
});
