import '@angular/compiler';
import { BehaviorSubject, EMPTY, firstValueFrom, Observable } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { APP_SETTINGS_DEFAULT, AppSettings } from '../models/settings';
import { AppSettingsService } from './app-settings.service';
import { ElevatedSidecarService, EnableResult } from './elevated-sidecar.service';
import { ModalService } from './modal.service';
import type { OpenVRService } from './openvr.service';
import type { TelemetryService } from './telemetry/telemetry.service';

const { invoke, listen } = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen }));
vi.mock('@tauri-apps/plugin-log', () => ({ info: vi.fn() }));

function setup(enableResult: EnableResult, dashboardVisible = false) {
  invoke.mockResolvedValue(enableResult);
  const settings = new BehaviorSubject<AppSettings>({
    ...structuredClone(APP_SETTINGS_DEFAULT),
    elevatedFeaturesEnabled: true,
  });
  const appSettings = {
    settings: settings.asObservable(),
    get settingsSync() {
      return settings.value;
    },
    updateSettings: (update: Partial<AppSettings>) =>
      settings.next({ ...settings.value, ...update }),
  } as unknown as AppSettingsService;
  const trackEvent = vi.fn();
  const modals = {
    addModal: vi.fn((): Observable<unknown> => EMPTY),
    closeModal: vi.fn(),
  };
  const service = new ElevatedSidecarService(
    appSettings,
    modals as unknown as ModalService,
    {
      trackEvent,
    } as unknown as TelemetryService,
    {
      isDashboardVisible: () => Promise.resolve(dashboardVisible),
    } as unknown as OpenVRService
  );
  return { service, settings, trackEvent, modals };
}

afterEach(() => {
  vi.resetAllMocks();
});

describe('ElevatedSidecarService', () => {
  it('publishes a declined startup prompt and keeps elevated features on', async () => {
    const h = setup({ result: 'promptDeclined' });

    await h.service.enable(false);

    expect(await firstValueFrom(h.service.failure)).toEqual({
      operation: 'enable',
      result: { result: 'promptDeclined' },
    });
    expect(h.settings.value.elevatedFeaturesEnabled).toBe(true);
  });

  it('publishes nothing for a prompt declined from the settings toggle', async () => {
    const h = setup({ result: 'promptDeclined' });

    await h.service.enable();

    expect(await firstValueFrom(h.service.failure)).toBeNull();
    expect(h.settings.value.elevatedFeaturesEnabled).toBe(false);
  });

  it('tracks a startup success and the code of a failed task', async () => {
    const h = setup({ result: 'ok' });
    await h.service.enable(false);

    invoke.mockResolvedValue({
      result: 'taskFailed',
      reason: 'the launcher could not stage the sidecar',
      code: 'launcherExit22',
    });
    await h.service.enable(false);

    expect(h.trackEvent.mock.calls).toEqual([
      ['elevated_features_enable', { result: 'ok', interactive: 0 }],
      [
        'elevated_features_enable',
        { result: 'taskFailed', interactive: 0, reason: 'launcherExit22' },
      ],
    ]);
  });

  it('clears the published failure once elevated features turn on', async () => {
    const h = setup({ result: 'promptDeclined' });
    await h.service.enable(false);

    invoke.mockResolvedValue({ result: 'ok' });
    await h.service.enable();

    expect(await firstValueFrom(h.service.failure)).toBeNull();
    expect(h.settings.value.elevatedFeaturesEnabled).toBe(true);
  });

  it('shows the desktop prompt notice in the dashboard until the enable resolves', async () => {
    const h = setup({ result: 'ok' }, true);
    const handlers = new Map<string, () => Promise<void>>();
    listen.mockImplementation(async (event: string, handler: () => Promise<void>) => {
      handlers.set(event, handler);
    });
    await h.service.init();
    const prompt = handlers.get('ELEVATION_PROMPT_SHOWN')!;

    // a prompt during the startup enable stays without a notice
    invoke.mockImplementation(async (command: string) => {
      if (command === 'elevated_features_enable') await prompt();
      return command === 'elevated_sidecar_started' ? false : { result: 'ok' };
    });
    await h.service.enable(false);
    expect(h.modals.addModal).not.toHaveBeenCalled();

    await h.service.enable();
    expect(h.modals.addModal).toHaveBeenCalledOnce();
    expect(h.modals.closeModal).toHaveBeenCalledWith('elevationPromptNotice');
  });

  it('closes a notice the modal service creates after the enable resolved', async () => {
    const h = setup({ result: 'promptDeclined' }, true);
    let noticeOpen = false;
    h.modals.addModal.mockImplementation(
      () =>
        new Observable(() => {
          setTimeout(() => (noticeOpen = true), 1);
        })
    );
    h.modals.closeModal.mockImplementation(() => (noticeOpen = false));
    const handlers = new Map<string, () => Promise<void>>();
    listen.mockImplementation(async (event: string, handler: () => Promise<void>) => {
      handlers.set(event, handler);
    });
    await h.service.init();
    const prompt = handlers.get('ELEVATION_PROMPT_SHOWN')!;
    invoke.mockImplementation(async (command: string) => {
      if (command === 'elevated_features_enable') await prompt();
      return command === 'elevated_sidecar_started' ? false : { result: 'promptDeclined' };
    });

    await h.service.enable();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(h.modals.addModal).toHaveBeenCalledOnce();
    expect(noticeOpen).toBe(false);
  });
});
