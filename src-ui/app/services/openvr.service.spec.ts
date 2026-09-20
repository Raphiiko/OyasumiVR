import { ApplicationRef } from '@angular/core';
import { AppSettingsService } from './app-settings.service';
import { TelemetryService } from './telemetry.service';
import { BehaviorSubject, firstValueFrom } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { listen, type EventCallback } from '@tauri-apps/api/event';
import { OpenVRService, type OpenVRStatus } from './openvr.service';
import { APP_SETTINGS_DEFAULT } from '../models/settings';
import type { OVRDevice } from '../models/ovr-device';
import type { DeviceUpdateEvent } from '../models/events';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock('@tauri-apps/plugin-log', () => ({ info: vi.fn(), error: vi.fn() }));

const controller: OVRDevice = {
  index: 1,
  class: 'Controller',
  role: 'LeftHand',
  battery: 80,
  pose: null,
  isTurningOff: false,
};

function emit<T>(name: string, payload: T) {
  const callback = vi.mocked(listen).mock.calls.find(([event]) => event === name)![1];
  (callback as EventCallback<T>)({ event: name, id: 1, payload });
}

async function beginInitialization() {
  let resolveSnapshot!: (devices: OVRDevice[]) => void;
  const snapshot = new Promise<OVRDevice[]>((resolve) => (resolveSnapshot = resolve));
  vi.mocked(invoke).mockImplementation(async (command) => {
    if (command === 'openvr_status') return 'INITIALIZED';
    if (command === 'openvr_get_devices') return snapshot;
    if (command === 'openvr_get_application_auto_launch') return false;
    return undefined;
  });
  const service = new OpenVRService(
    { tick: vi.fn() } as unknown as ConstructorParameters<typeof OpenVRService>[0],
    createSettingsService(),
    { trackThrottledEvent: vi.fn() } as unknown as ConstructorParameters<typeof OpenVRService>[2]
  );
  const initialized = service.init();
  await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith('openvr_get_devices'));
  return { service, initialized, resolveSnapshot };
}

function createSettingsService(initial: Partial<typeof APP_SETTINGS_DEFAULT> = {}) {
  const subject = new BehaviorSubject({
    ...structuredClone(APP_SETTINGS_DEFAULT),
    ...initial,
  });
  return {
    settings: subject,
    get settingsSync() {
      return subject.value;
    },
    updateSettings(update: Partial<typeof APP_SETTINGS_DEFAULT>) {
      subject.next({ ...subject.value, ...update });
    },
  } as unknown as AppSettingsService;
}

describe('OpenVR initial device snapshot', () => {
  beforeEach(() => vi.clearAllMocks());

  it('restores devices whose first event preceded frontend initialization', async () => {
    const { service, initialized, resolveSnapshot } = await beginInitialization();
    resolveSnapshot([controller]);
    await initialized;
    expect(await firstValueFrom(service.devices)).toEqual([controller]);
  });

  it('keeps newer device events while filling missing cached devices', async () => {
    const { service, initialized, resolveSnapshot } = await beginInitialization();
    const latest = { ...controller, battery: 60 };
    emit<DeviceUpdateEvent>('OVR_DEVICE_UPDATE', { device: latest });
    const tracker = { ...controller, index: 2, class: 'GenericTracker' as const };
    resolveSnapshot([controller, tracker]);
    await initialized;
    expect(await firstValueFrom(service.devices)).toEqual([latest, tracker]);
  });

  it.each(['INACTIVE', 'INITIALIZING'] as const)(
    'does not restore stale devices after %s',
    async (status) => {
      const { service, initialized, resolveSnapshot } = await beginInitialization();
      emit<OpenVRStatus>('OVR_STATUS_UPDATE', status);
      resolveSnapshot([controller]);
      await initialized;
      expect(await firstValueFrom(service.devices)).toEqual([]);
    }
  );

  it('does not restore an old session after OpenVR reconnects during the cache read', async () => {
    const { service, initialized, resolveSnapshot } = await beginInitialization();
    emit<OpenVRStatus>('OVR_STATUS_UPDATE', 'INACTIVE');
    emit<OpenVRStatus>('OVR_STATUS_UPDATE', 'INITIALIZED');
    const replacement = { ...controller, serialNumber: 'new controller' };
    emit<DeviceUpdateEvent>('OVR_DEVICE_UPDATE', { device: replacement });
    resolveSnapshot([controller, { ...controller, index: 2 }]);
    await initialized;
    expect(await firstValueFrom(service.devices)).toEqual([replacement]);
  });
});

describe('Start with SteamVR synchronization', () => {
  beforeEach(() => vi.clearAllMocks());

  function createService(appSettings = createSettingsService()) {
    return new OpenVRService({ tick: vi.fn() } as unknown as ApplicationRef, appSettings, {
      trackThrottledEvent: vi.fn(),
    } as unknown as TelemetryService);
  }

  async function startInactiveService(appSettings = createSettingsService(), autoLaunch = false) {
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === 'openvr_status') return 'INACTIVE';
      if (command === 'openvr_get_devices') return [];
      if (command === 'openvr_get_application_auto_launch') return autoLaunch;
      return undefined;
    });
    const service = createService(appSettings);
    await service.init();
    return service;
  }

  it('adopts the SteamVR value the first time SteamVR initializes', async () => {
    const appSettings = createSettingsService();
    await startInactiveService(appSettings, true);
    emit<OpenVRStatus>('OVR_STATUS_UPDATE', 'INITIALIZED');
    await vi.waitFor(() => {
      expect(appSettings.settingsSync).toMatchObject({
        startWithSteamVR: true,
        startWithSteamVRPreferenceSet: true,
      });
    });
    expect(invoke).not.toHaveBeenCalledWith('openvr_set_application_auto_launch', {
      enabled: true,
    });
  });

  it('applies a stored preference when SteamVR initializes', async () => {
    const appSettings = createSettingsService({
      startWithSteamVR: true,
      startWithSteamVRPreferenceSet: true,
    });
    let autoLaunch = false;
    vi.mocked(invoke).mockImplementation(async (command, args) => {
      if (command === 'openvr_status') return 'INACTIVE';
      if (command === 'openvr_get_devices') return [];
      if (command === 'openvr_get_application_auto_launch') return autoLaunch;
      if (command === 'openvr_set_application_auto_launch') autoLaunch = args!.enabled;
      return undefined;
    });
    const service = createService(appSettings);
    await service.init();
    emit<OpenVRStatus>('OVR_STATUS_UPDATE', 'INITIALIZED');
    await vi.waitFor(() => expect(autoLaunch).toBe(true));
    expect(appSettings.settingsSync.startWithSteamVR).toBe(true);
  });

  it('stores an offline preference without launching OpenVR work', async () => {
    const appSettings = createSettingsService();
    const service = createService(appSettings);
    await service.setStartWithSteamVR(true);
    expect(invoke).not.toHaveBeenCalled();
    expect(appSettings.settingsSync).toMatchObject({
      startWithSteamVR: true,
      startWithSteamVRPreferenceSet: true,
    });
  });

  it('mirrors a SteamVR-side change after reconciliation', async () => {
    const appSettings = createSettingsService();
    let autoLaunch = false;
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === 'openvr_status') return 'INACTIVE';
      if (command === 'openvr_get_devices') return [];
      if (command === 'openvr_get_application_auto_launch') return autoLaunch;
      return undefined;
    });
    const service = createService(appSettings);
    await service.init();
    emit<OpenVRStatus>('OVR_STATUS_UPDATE', 'INITIALIZED');
    await vi.waitFor(() =>
      expect(appSettings.settingsSync.startWithSteamVRPreferenceSet).toBe(true)
    );
    autoLaunch = true;
    await (
      service as unknown as { syncApplicationAutoLaunchChanges(): void }
    ).syncApplicationAutoLaunchChanges();
    await vi.waitFor(() => expect(appSettings.settingsSync.startWithSteamVR).toBe(true));
  });

  it('reports a failed write without adopting the failed value', async () => {
    const appSettings = createSettingsService({
      startWithSteamVR: true,
      startWithSteamVRPreferenceSet: true,
    });
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === 'openvr_status') return 'INACTIVE';
      if (command === 'openvr_get_devices') return [];
      if (command === 'openvr_get_application_auto_launch') return false;
      if (command === 'openvr_set_application_auto_launch') throw new Error('write failed');
      return undefined;
    });
    const service = createService(appSettings);
    await service.init();
    emit<OpenVRStatus>('OVR_STATUS_UPDATE', 'INITIALIZED');
    await vi.waitFor(async () =>
      expect(await firstValueFrom(service.autoLaunchSyncState)).toBe('ERROR')
    );
    expect(appSettings.settingsSync.startWithSteamVR).toBe(true);
  });

  it('retries a failed user write', async () => {
    const appSettings = createSettingsService({
      startWithSteamVR: false,
      startWithSteamVRPreferenceSet: true,
    });
    let writeCount = 0;
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === 'openvr_status') return 'INACTIVE';
      if (command === 'openvr_get_devices') return [];
      if (command === 'openvr_get_application_auto_launch') return writeCount >= 2;
      if (command === 'openvr_set_application_auto_launch') {
        writeCount++;
        if (writeCount === 1) throw new Error('write failed');
        return true;
      }
      return undefined;
    });
    const service = createService(appSettings);
    await service.init();
    emit<OpenVRStatus>('OVR_STATUS_UPDATE', 'INITIALIZED');
    await vi.waitFor(() =>
      expect(appSettings.settingsSync.startWithSteamVRPreferenceSet).toBe(true)
    );
    await service.setStartWithSteamVR(true).catch(() => undefined);
    expect(appSettings.settingsSync.startWithSteamVR).toBe(true);
    await (
      service as unknown as { syncApplicationAutoLaunchChanges(): void }
    ).syncApplicationAutoLaunchChanges();
    await vi.waitFor(() => expect(writeCount).toBe(2));
  });

  it('discards stale work after SteamVR stops', async () => {
    const appSettings = createSettingsService();
    let resolveRead!: (enabled: boolean) => void;
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === 'openvr_status') return 'INACTIVE';
      if (command === 'openvr_get_devices') return [];
      if (command === 'openvr_get_application_auto_launch')
        return new Promise<boolean>((resolve) => (resolveRead = resolve));
      return undefined;
    });
    const service = createService(appSettings);
    await service.init();
    emit<OpenVRStatus>('OVR_STATUS_UPDATE', 'INITIALIZED');
    await Promise.resolve();
    emit<OpenVRStatus>('OVR_STATUS_UPDATE', 'INACTIVE');
    resolveRead(true);
    await Promise.resolve();
    expect(appSettings.settingsSync.startWithSteamVRPreferenceSet).toBe(false);
  });
});

it('keeps devices in tracked-index order across arrivals and repeated updates', async () => {
  const service = new OpenVRService(
    { tick: vi.fn() } as unknown as ApplicationRef,
    {} as AppSettingsService,
    {} as TelemetryService
  );
  const device = (index: number): OVRDevice => ({
    index,
    class: 'GenericTracker',
    role: 'Invalid',
    battery: 50,
    pose: null,
    canPowerOff: true,
    isTurningOff: false,
  });

  for (const index of [12, 0, 3]) service.onDeviceUpdate(device(index));
  expect((await firstValueFrom(service.devices)).map((d) => d.index)).toEqual([0, 3, 12]);

  for (const index of [12, 3, 12]) {
    service.onDeviceUpdate({ ...device(index), battery: 40, isTurningOff: true });
    const devices = await firstValueFrom(service.devices);
    expect(devices.map((d) => d.index)).toEqual([0, 3, 12]);
    expect(devices.find((d) => d.index === index)).toMatchObject({
      battery: 40,
      isTurningOff: true,
    });
  }
});
