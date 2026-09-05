import '@angular/compiler';
import { of } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UpdateService } from './update.service';
import { UpdateModalComponent } from '../components/update-modal/update-modal.component';
import { SettingsUpdatesViewComponent } from '../views/dashboard-view/views/settings-updates-view/settings-updates-view.component';
import type { Update } from '@tauri-apps/plugin-updater';

const { relaunch, check } = vi.hoisted(() => ({ relaunch: vi.fn(), check: vi.fn() }));
vi.mock('@tauri-apps/plugin-updater', () => ({ check }));
vi.mock('@tauri-apps/plugin-process', () => ({ relaunch }));
vi.mock('@tauri-apps/plugin-log', () => ({ info: vi.fn(), error: vi.fn() }));
vi.mock('../../build', () => ({ FLAVOUR: 'STANDALONE' }));
vi.mock('src-ui/build', () => ({ FLAVOUR: 'STANDALONE' }));
vi.mock('../components/confirm-modal/confirm-modal.component', () => ({
  ConfirmModalComponent: class {},
}));
vi.mock('src-ui/app/components/base-modal/base-modal.component', () => ({
  BaseModalComponent: class {
    close() {}
  },
}));
vi.mock('src-ui/app/utils/animations', () => ({ hshrink: () => [] }));

function deferred() {
  let resolve!: () => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function setup() {
  const download = deferred();
  const downloadAndInstall = vi.fn(() => download.promise);
  const update = { downloadAndInstall, version: '2', currentVersion: '1' } as unknown as Update;
  check.mockResolvedValue(update);
  relaunch.mockResolvedValue(undefined);
  const addModal = vi.fn(() => of({}));
  const service = new UpdateService({ addModal } as unknown as ConstructorParameters<
    typeof UpdateService
  >[0]);
  await service.checkForUpdate();
  return { service, download, downloadAndInstall, addModal, update };
}

afterEach(() => {
  vi.useRealTimers();
  vi.resetAllMocks();
});

describe('update installation lifecycle', () => {
  it('waits for installation and relaunch before settling', async () => {
    const h = await setup();
    const restart = deferred();
    relaunch.mockReturnValueOnce(restart.promise);
    const settled = vi.fn();
    const installing = h.service.installUpdate().then(settled);
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();
    expect(relaunch).not.toHaveBeenCalled();
    h.download.resolve();
    await Promise.resolve();
    expect(relaunch).toHaveBeenCalledTimes(1);
    expect(settled).not.toHaveBeenCalled();
    restart.resolve();
    await installing;
    expect(settled).toHaveBeenCalledTimes(1);
    expect(h.addModal).not.toHaveBeenCalled();
  });

  it('handles an asynchronous installation failure once and permits retry', async () => {
    const h = await setup();
    const installing = h.service.installUpdate();
    h.download.reject(new Error('download failed'));
    await installing;
    expect(h.addModal).toHaveBeenCalledTimes(1);
    expect(relaunch).not.toHaveBeenCalled();
    h.downloadAndInstall.mockResolvedValueOnce();
    await h.service.installUpdate();
    expect(h.downloadAndInstall).toHaveBeenCalledTimes(2);
    expect(relaunch).toHaveBeenCalledTimes(1);
    expect(h.addModal).toHaveBeenCalledTimes(1);
  });

  it('handles relaunch rejection through the existing error modal', async () => {
    const h = await setup();
    relaunch.mockRejectedValueOnce(new Error('restart failed'));
    const installing = h.service.installUpdate();
    h.download.resolve();
    await installing;
    expect(h.addModal).toHaveBeenCalledTimes(1);
  });

  it('does nothing when there is no update', async () => {
    const h = await setup();
    check.mockResolvedValueOnce(null);
    await h.service.checkForUpdate();
    await h.service.installUpdate();
    expect(h.downloadAndInstall).not.toHaveBeenCalled();
    expect(relaunch).not.toHaveBeenCalled();
  });

  it('keeps settings busy past one second, suppresses another click, and permits retry', async () => {
    vi.useFakeTimers();
    const h = await setup();
    type Dependencies = ConstructorParameters<typeof SettingsUpdatesViewComponent>;
    const settings = new SettingsUpdatesViewComponent(
      h.service,
      {} as Dependencies[1],
      {} as Dependencies[2],
      {} as Dependencies[3],
      {} as Dependencies[4]
    );
    settings['updateAvailable'] = { checked: true, update: h.update };
    const installing = settings.updateOrCheck();
    await vi.advanceTimersByTimeAsync(2000);
    expect(settings['updateOrCheckInProgress']).toBe(true);
    await settings.updateOrCheck();
    expect(h.downloadAndInstall).toHaveBeenCalledTimes(1);
    h.download.reject(new Error('download failed'));
    await installing;
    expect(settings['updateOrCheckInProgress']).toBe(false);
    expect(h.addModal).toHaveBeenCalledTimes(1);
    h.downloadAndInstall.mockResolvedValueOnce();
    const retry = settings.updateOrCheck();
    await vi.advanceTimersByTimeAsync(1000);
    await retry;
    expect(h.downloadAndInstall).toHaveBeenCalledTimes(2);
    expect(settings['updateOrCheckInProgress']).toBe(false);
  });

  it('clears modal busy state after failure and marks the OnPush view for checking', async () => {
    const h = await setup();
    const markForCheck = vi.fn();
    const modal = new UpdateModalComponent(h.service, {
      markForCheck,
    } as unknown as ConstructorParameters<typeof UpdateModalComponent>[1]);
    const installing = modal.install();
    expect(modal.installing).toBe(true);
    await modal.install();
    expect(h.downloadAndInstall).toHaveBeenCalledTimes(1);
    h.download.reject(new Error('download failed'));
    await installing;
    expect(modal.installing).toBe(false);
    expect(markForCheck).toHaveBeenCalledTimes(1);
    h.downloadAndInstall.mockResolvedValueOnce();
    await modal.install();
    expect(h.downloadAndInstall).toHaveBeenCalledTimes(2);
    expect(modal.installing).toBe(false);
  });
});
