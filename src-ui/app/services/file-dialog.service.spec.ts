import '@angular/compiler';
import { Injector, runInInjectionContext } from '@angular/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FileDialogService } from './file-dialog.service';
import { OpenVRService } from './openvr.service';
import { ToastService } from './toast.service';

const { open, save } = vi.hoisted(() => ({ open: vi.fn(), save: vi.fn() }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open, save }));
vi.mock('./openvr.service', () => ({ OpenVRService: class {} }));

function setup(dashboardVisible: boolean) {
  const show = vi.fn();
  const injector = Injector.create({
    providers: [
      { provide: OpenVRService, useValue: { isDashboardVisible: async () => dashboardVisible } },
      { provide: ToastService, useValue: { show } },
    ],
  });
  const service = runInInjectionContext(injector, () => new FileDialogService());
  return { service, show };
}

afterEach(() => {
  vi.resetAllMocks();
});

describe('FileDialogService', () => {
  it('shows a toast while the SteamVR dashboard is visible', async () => {
    const h = setup(true);
    save.mockResolvedValueOnce('C:\\report.zip');
    expect(await h.service.save({ defaultPath: 'report.zip' })).toBe('C:\\report.zip');
    expect(save).toHaveBeenCalledWith({ defaultPath: 'report.zip' });
    expect(h.show).toHaveBeenCalledWith({ title: 'toasts.fileDialog.opened' });
  });

  it('shows no toast on the desktop', async () => {
    const h = setup(false);
    open.mockResolvedValueOnce('C:\\lighthouse_console.exe');
    expect(await h.service.open({ multiple: false })).toBe('C:\\lighthouse_console.exe');
    expect(h.show).not.toHaveBeenCalled();
  });

  it('opens no second dialog while one is open, and shows the toast again', async () => {
    const h = setup(true);
    let finish!: (path: string) => void;
    open.mockReturnValueOnce(new Promise((resolve) => (finish = resolve)));
    const first = h.service.open({ multiple: false });
    expect(await h.service.open({ multiple: false })).toBeNull();
    expect(open).toHaveBeenCalledTimes(1);
    expect(h.show).toHaveBeenCalledTimes(2);

    finish('C:\\first.exe');
    expect(await first).toBe('C:\\first.exe');
    open.mockResolvedValueOnce('C:\\second.exe');
    expect(await h.service.open({ multiple: false })).toBe('C:\\second.exe');
  });

  it('allows a new dialog after one fails', async () => {
    const h = setup(false);
    open.mockRejectedValueOnce(new Error('dialog failed'));
    await expect(h.service.open({})).rejects.toThrow('dialog failed');
    open.mockResolvedValueOnce(null);
    expect(await h.service.open({})).toBeNull();
    expect(open).toHaveBeenCalledTimes(2);
  });
});
