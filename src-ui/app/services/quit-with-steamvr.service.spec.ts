import '@angular/compiler';
import { BehaviorSubject, firstValueFrom, Subject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { APP_SETTINGS_DEFAULT } from '../models/settings';
import { AppSettingsService } from './app-settings.service';
import { OpenVRService, OpenVRStatus } from './openvr.service';
import { QuitWithSteamVRService } from './quit-with-steamvr.service';
import { ShutdownAutomationsService, ShutdownSequenceStage } from './shutdown-automations.service';
import { Toast, ToastService } from './toast.service';

const { exit } = vi.hoisted(() => ({ exit: vi.fn() }));
vi.mock('@tauri-apps/plugin-process', () => ({ exit }));
vi.mock('@tauri-apps/plugin-log', () => ({ info: vi.fn(), error: vi.fn() }));

async function currentToasts(service: ToastService): Promise<Toast[]> {
  return firstValueFrom(service.toasts);
}

async function setup(stageValue: ShutdownSequenceStage = 'IDLE') {
  const settings = new BehaviorSubject({
    ...structuredClone(APP_SETTINGS_DEFAULT),
    quitWithSteamVR: true,
  });
  const status = new BehaviorSubject<OpenVRStatus>('INITIALIZED');
  const stage = new BehaviorSubject<ShutdownSequenceStage>(stageValue);
  const sequenceCancelled = new Subject<void>();
  const toasts = new ToastService();
  const service = new QuitWithSteamVRService(
    { settings: settings.asObservable() } as AppSettingsService,
    { status: status.asObservable() } as OpenVRService,
    {
      stage: stage.asObservable(),
      sequenceCancelled: sequenceCancelled.asObservable(),
    } as ShutdownAutomationsService,
    toasts
  );
  await service.init();
  return { service, settings, status, stage, sequenceCancelled, toasts };
}

beforeEach(() => {
  vi.useFakeTimers();
  exit.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.resetAllMocks();
});

describe('QuitWithSteamVRService', () => {
  it('shows a non-pausable countdown and quits after ten seconds', async () => {
    const h = await setup();
    h.status.next('INACTIVE');

    expect(await currentToasts(h.toasts)).toEqual([
      expect.objectContaining({
        type: 'warning',
        duration: 10_000,
        dismissable: false,
        pauseOnHover: false,
      }),
    ]);
    await vi.advanceTimersByTimeAsync(9_999);
    expect(exit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(exit).toHaveBeenCalledWith(0);
  });

  it('cancels the quit when SteamVR restarts', async () => {
    const h = await setup();
    h.status.next('INACTIVE');
    await vi.advanceTimersByTimeAsync(5_000);
    h.status.next('INITIALIZED');

    expect(await currentToasts(h.toasts)).toEqual([
      expect.objectContaining({
        type: 'success',
        title: 'toasts.quitWithSteamVR.cancelled.title',
        message: 'toasts.quitWithSteamVR.cancelled.steamVRRestarted',
        duration: 3_000,
      }),
    ]);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(exit).not.toHaveBeenCalled();
  });

  it('cancels the quit as soon as SteamVR starts initializing', async () => {
    const h = await setup();
    h.status.next('INACTIVE');
    await vi.advanceTimersByTimeAsync(9_999);
    h.status.next('INITIALIZING');
    await vi.advanceTimersByTimeAsync(1);

    expect(exit).not.toHaveBeenCalled();
    expect(await currentToasts(h.toasts)).toEqual([
      expect.objectContaining({
        type: 'success',
        message: 'toasts.quitWithSteamVR.cancelled.steamVRRestarted',
      }),
    ]);
  });

  it('waits for an active shutdown sequence after the grace period', async () => {
    const h = await setup('POWERING_DOWN');
    h.status.next('INACTIVE');
    await vi.advanceTimersByTimeAsync(10_000);

    expect(exit).not.toHaveBeenCalled();
    expect(await currentToasts(h.toasts)).toEqual([
      expect.objectContaining({
        type: 'pending',
        title: 'toasts.quitWithSteamVR.waiting.title',
        duration: 0,
      }),
    ]);
    h.stage.next('IDLE');
    await Promise.resolve();
    expect(exit).toHaveBeenCalledWith(0);
  });

  it('stays open when the shutdown sequence is cancelled', async () => {
    const h = await setup('POWERING_DOWN');
    h.status.next('INACTIVE');
    await vi.advanceTimersByTimeAsync(10_000);
    h.sequenceCancelled.next();
    h.stage.next('IDLE');
    await Promise.resolve();

    expect(exit).not.toHaveBeenCalled();
    expect(await currentToasts(h.toasts)).toEqual([
      expect.objectContaining({
        type: 'success',
        message: 'toasts.quitWithSteamVR.cancelled.shutdownSequence',
        duration: 3_000,
      }),
    ]);
  });

  it('honors a shutdown sequence cancellation before SteamVR stops', async () => {
    const h = await setup('QUITTING_STEAMVR');
    h.sequenceCancelled.next();
    h.stage.next('IDLE');
    await vi.advanceTimersByTimeAsync(60_000);
    h.status.next('INACTIVE');
    await vi.advanceTimersByTimeAsync(10_000);

    expect(exit).not.toHaveBeenCalled();
    expect(await currentToasts(h.toasts)).toEqual([
      expect.objectContaining({
        type: 'success',
        message: 'toasts.quitWithSteamVR.cancelled.shutdownSequence',
        duration: 3_000,
      }),
    ]);
  });

  it('preserves shutdown cancellation suppression through initialization', async () => {
    const h = await setup('QUITTING_STEAMVR');
    h.sequenceCancelled.next();
    h.stage.next('IDLE');
    h.status.next('INITIALIZING');
    h.status.next('INITIALIZED');
    h.status.next('INACTIVE');
    await vi.advanceTimersByTimeAsync(10_000);

    expect(exit).not.toHaveBeenCalled();
  });

  it('does not show shutdown cancellation when quit with SteamVR is disabled', async () => {
    const h = await setup('QUITTING_STEAMVR');
    h.settings.next({ ...h.settings.value, quitWithSteamVR: false });
    h.sequenceCancelled.next();

    expect(await currentToasts(h.toasts)).toEqual([]);
  });

  it('clears shutdown cancellation suppression when a new sequence starts', async () => {
    const h = await setup('QUITTING_STEAMVR');
    h.sequenceCancelled.next();
    h.stage.next('IDLE');
    h.stage.next('QUITTING_STEAMVR');
    h.status.next('INACTIVE');
    h.stage.next('IDLE');
    await vi.advanceTimersByTimeAsync(10_000);

    expect(exit).toHaveBeenCalledWith(0);
  });
});
