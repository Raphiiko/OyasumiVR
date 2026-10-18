import '@angular/compiler';
import { BehaviorSubject, firstValueFrom } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { APP_SETTINGS_DEFAULT, AppSettings } from '../models/settings';
import { AppSettingsService } from './app-settings.service';
import { ElevatedSidecarService, EnableResult } from './elevated-sidecar.service';
import { ModalService } from './modal.service';
import type { TelemetryService } from './telemetry/telemetry.service';

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));
vi.mock('@tauri-apps/plugin-log', () => ({ info: vi.fn() }));

function setup(enableResult: EnableResult) {
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
  const service = new ElevatedSidecarService(
    appSettings,
    {} as ModalService,
    {
      trackEvent,
    } as unknown as TelemetryService
  );
  return { service, settings, trackEvent };
}

afterEach(() => {
  vi.resetAllMocks();
});

describe('ElevatedSidecarService', () => {
  it('publishes a declined startup prompt and turns elevated features off', async () => {
    const h = setup({ result: 'promptDeclined' });

    await h.service.enable(false);

    expect(await firstValueFrom(h.service.failure)).toEqual({
      operation: 'enable',
      result: { result: 'promptDeclined' },
    });
    expect(h.settings.value.elevatedFeaturesEnabled).toBe(false);
  });

  it('publishes nothing for a prompt declined from the settings toggle', async () => {
    const h = setup({ result: 'promptDeclined' });

    await h.service.enable();

    expect(await firstValueFrom(h.service.failure)).toBeNull();
    expect(h.settings.value.elevatedFeaturesEnabled).toBe(false);
  });

  it('keeps elevated features on when the startup enable needs a prompt', async () => {
    const h = setup({ result: 'promptRequired' });

    await h.service.enable(false);

    expect(invoke).toHaveBeenCalledWith('elevated_features_enable', { interactive: false });
    expect(await firstValueFrom(h.service.failure)).toEqual({
      operation: 'enable',
      result: { result: 'promptRequired' },
    });
    expect(h.settings.value.elevatedFeaturesEnabled).toBe(true);
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
});
