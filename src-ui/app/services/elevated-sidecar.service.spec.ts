import '@angular/compiler';
import { BehaviorSubject, firstValueFrom } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { APP_SETTINGS_DEFAULT, AppSettings } from '../models/settings';
import { AppSettingsService } from './app-settings.service';
import { ElevatedSidecarService, EnableResult } from './elevated-sidecar.service';
import { ModalService } from './modal.service';

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
  const service = new ElevatedSidecarService(appSettings, {} as ModalService);
  return { service, settings };
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

  it('clears the published failure once elevated features turn on', async () => {
    const h = setup({ result: 'promptDeclined' });
    await h.service.enable(false);

    invoke.mockResolvedValue({ result: 'ok' });
    await h.service.enable();

    expect(await firstValueFrom(h.service.failure)).toBeNull();
    expect(h.settings.value.elevatedFeaturesEnabled).toBe(true);
  });
});
