import { ApplicationRef } from '@angular/core';
import { AppSettingsService } from './app-settings.service';
import { TelemetryService } from './telemetry/telemetry.service';
import { BehaviorSubject, firstValueFrom } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { listen, type EventCallback } from '@tauri-apps/api/event';
import { OpenVRService, type OpenVRStatus } from './openvr.service';
import { APP_SETTINGS_DEFAULT } from '../models/settings';
import type { OVRDevice } from '../models/ovr-device';

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
  const devicesRequested = Promise.withResolvers<void>();
  vi.mocked(invoke).mockImplementation(async (command) => {
    if (command === 'openvr_status') return 'INITIALIZED';
    if (command === 'openvr_get_devices') {
      devicesRequested.resolve();
      return snapshot;
    }
    if (command === 'openvr_get_application_auto_launch') return false;
    return undefined;
  });
  const service = new OpenVRService(
    { tick: vi.fn() } as unknown as ConstructorParameters<typeof OpenVRService>[0],
    createSettingsService(),
    { trackThrottledEvent: vi.fn() } as unknown as ConstructorParameters<typeof OpenVRService>[2]
  );
  const initialized = service.init();
  await devicesRequested.promise;
  expect(invoke).toHaveBeenCalledWith('openvr_get_devices');
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
    emit('ovr-device-update-event', { device: latest });
    const tracker = { ...controller, index: 2, class: 'GenericTracker' as const };
    resolveSnapshot([controller, tracker]);
    await initialized;
    expect(await firstValueFrom(service.devices)).toEqual([latest, tracker]);
  });

  it.each(['INACTIVE', 'INITIALIZING'] as const)(
    'does not restore stale devices after %s',
    async (status) => {
      const { service, initialized, resolveSnapshot } = await beginInitialization();
      emit<OpenVRStatus>('ovr-status-update-event', status);
      resolveSnapshot([controller]);
      await initialized;
      expect(await firstValueFrom(service.devices)).toEqual([]);
    }
  );

  it('does not restore an old session after OpenVR reconnects during the cache read', async () => {
    const { service, initialized, resolveSnapshot } = await beginInitialization();
    emit<OpenVRStatus>('ovr-status-update-event', 'INACTIVE');
    emit<OpenVRStatus>('ovr-status-update-event', 'INITIALIZED');
    const replacement = { ...controller, serialNumber: 'new controller' };
    emit('ovr-device-update-event', { device: replacement });
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

  function flushAutoLaunch(service: OpenVRService): Promise<void> {
    return (service as unknown as { autoLaunchQueue: Promise<void> }).autoLaunchQueue;
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

  it('adopts the SteamVR value when no write is pending', async () => {
    const appSettings = createSettingsService();
    const service = await startInactiveService(appSettings, true);
    emit<OpenVRStatus>('ovr-status-update-event', 'INITIALIZED');
    await flushAutoLaunch(service);
    expect(appSettings.settingsSync).toMatchObject({
      startWithSteamVR: true,
      startWithSteamVRPending: false,
    });
    expect(invoke).not.toHaveBeenCalledWith('openvr_set_application_auto_launch', {
      enabled: true,
    });
  });

  it('applies a pending value when SteamVR initializes', async () => {
    const appSettings = createSettingsService({
      startWithSteamVR: true,
      startWithSteamVRPending: true,
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
    emit<OpenVRStatus>('ovr-status-update-event', 'INITIALIZED');
    await flushAutoLaunch(service);
    expect(appSettings.settingsSync.startWithSteamVRPending).toBe(false);
    expect(autoLaunch).toBe(true);
  });

  it('stores an offline toggle without OpenVR work', async () => {
    const appSettings = createSettingsService();
    const service = createService(appSettings);
    await service.setStartWithSteamVR(true);
    expect(invoke).not.toHaveBeenCalled();
    expect(appSettings.settingsSync).toMatchObject({
      startWithSteamVR: true,
      startWithSteamVRPending: true,
    });
  });

  it('mirrors a SteamVR-side change when no write is pending', async () => {
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
    emit<OpenVRStatus>('ovr-status-update-event', 'INITIALIZED');
    await flushAutoLaunch(service);
    expect(appSettings.settingsSync.startWithSteamVR).toBe(false);
    autoLaunch = true;
    (service as unknown as { syncAutoLaunch(): Promise<void> }).syncAutoLaunch();
    await (service as unknown as { syncAutoLaunch(): Promise<void> }).syncAutoLaunch();
    expect(appSettings.settingsSync.startWithSteamVR).toBe(true);
  });

  it('keeps the desired value and pending flag after a failed write', async () => {
    const appSettings = createSettingsService();
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === 'openvr_status') return 'INACTIVE';
      if (command === 'openvr_get_devices') return [];
      if (command === 'openvr_get_application_auto_launch') return false;
      if (command === 'openvr_set_application_auto_launch') throw 'write failed';
      return undefined;
    });
    const service = createService(appSettings);
    await service.init();
    emit<OpenVRStatus>('ovr-status-update-event', 'INITIALIZED');
    await flushAutoLaunch(service);
    expect(appSettings.settingsSync.startWithSteamVR).toBe(false);
    await service.setStartWithSteamVR(true);
    expect(appSettings.settingsSync).toMatchObject({
      startWithSteamVR: true,
      startWithSteamVRPending: true,
    });
  });

  it('does not let a queued poll overwrite a failed write', async () => {
    const appSettings = createSettingsService();
    let autoLaunch = false;
    const firstWrite = Promise.withResolvers<void>();
    const firstWriteStarted = Promise.withResolvers<void>();
    let writeCount = 0;
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === 'openvr_status') return 'INACTIVE';
      if (command === 'openvr_get_devices') return [];
      if (command === 'openvr_get_application_auto_launch') return autoLaunch;
      if (command === 'openvr_set_application_auto_launch') {
        writeCount++;
        if (writeCount === 1) {
          firstWriteStarted.resolve();
          return firstWrite.promise;
        }
        autoLaunch = true;
      }
      return undefined;
    });
    const service = createService(appSettings);
    await service.init();
    emit<OpenVRStatus>('ovr-status-update-event', 'INITIALIZED');
    await flushAutoLaunch(service);
    expect(appSettings.settingsSync.startWithSteamVR).toBe(false);
    const write = service.setStartWithSteamVR(true);
    await firstWriteStarted.promise;
    firstWrite.reject('write failed');
    await write;
    expect(appSettings.settingsSync).toMatchObject({
      startWithSteamVR: true,
      startWithSteamVRPending: true,
    });

    await (service as unknown as { syncAutoLaunch(): Promise<void> }).syncAutoLaunch();
    expect(writeCount).toBe(2);
    expect(autoLaunch).toBe(true);
    expect(appSettings.settingsSync.startWithSteamVRPending).toBe(false);
  });

  it('discards stale work after SteamVR stops', async () => {
    const appSettings = createSettingsService();
    let resolveRead!: (enabled: boolean) => void;
    vi.mocked(invoke).mockImplementation(async (command) => {
      if (command === 'openvr_status') return 'INACTIVE';
      if (command === 'openvr_get_devices') return [];
      if (command === 'openvr_get_application_auto_launch')
        return new Promise<boolean>((resolve) => (resolveRead = resolve));
      if (command === 'openvr_set_application_auto_launch') return true;
      return undefined;
    });
    const service = createService(appSettings);
    await service.init();
    emit<OpenVRStatus>('ovr-status-update-event', 'INITIALIZED');
    await Promise.resolve();
    emit<OpenVRStatus>('ovr-status-update-event', 'INACTIVE');
    resolveRead(true);
    await (service as unknown as { autoLaunchQueue: Promise<void> }).autoLaunchQueue;
    expect(appSettings.settingsSync.startWithSteamVR).toBe(false);
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
    isConnected: true,
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

it('keeps a device turning off until it disconnects', async () => {
  const service = new OpenVRService(
    { tick: vi.fn() } as unknown as ApplicationRef,
    {} as AppSettingsService,
    {} as TelemetryService
  );
  const device: OVRDevice = {
    index: 1,
    class: 'Controller',
    role: 'LeftHand',
    battery: 0.5,
    pose: null,
    canPowerOff: true,
    isConnected: true,
    isTurningOff: true,
  };
  // the core sends updates without isTurningOff
  const coreUpdate = (state: Partial<OVRDevice>) =>
    service.onDeviceUpdate({
      ...device,
      isTurningOff: undefined,
      ...state,
    } as unknown as OVRDevice);
  const current = async () => (await firstValueFrom(service.devices))[0];

  service.onDeviceUpdate(device);
  coreUpdate({ canPowerOff: false });
  expect((await current()).isTurningOff).toBe(true);

  coreUpdate({ canPowerOff: false, isConnected: false });
  expect((await current()).isTurningOff).toBe(false);
});

it('remembers devices it could turn off once', () => {
  const service = new OpenVRService(
    { tick: vi.fn() } as unknown as ApplicationRef,
    {} as AppSettingsService,
    {} as TelemetryService
  );
  const device: OVRDevice = {
    index: 1,
    class: 'Controller',
    role: 'LeftHand',
    serialNumber: 'C1',
    battery: 0.5,
    pose: null,
    canPowerOff: false,
    isConnected: true,
    isTurningOff: false,
  };

  service.onDeviceUpdate(device);
  expect(service.hasHadPowerControl(device)).toBe(false);
  service.onDeviceUpdate({ ...device, canPowerOff: true });
  service.onDeviceUpdate({ ...device, canPowerOff: false, isConnected: false });
  expect(service.hasHadPowerControl(device)).toBe(true);
  expect(service.hasHadPowerControl({ ...device, serialNumber: 'C2' })).toBe(false);
});

it('applies overrides by serial and falls back to the reported values', async () => {
  const service = new OpenVRService(
    { tick: vi.fn() } as unknown as ApplicationRef,
    {} as AppSettingsService,
    {} as TelemetryService
  );
  const device: OVRDevice = {
    index: 1,
    class: 'Controller',
    role: 'LeftHand',
    serialNumber: 'C1',
    battery: 0.5,
    pose: null,
    isConnected: true,
    powerMethod: 'None',
    isTurningOff: false,
  };
  const current = async () => (await firstValueFrom(service.devices))[0];

  service.onDeviceUpdate(device);
  service.setOverrides({ C1: { powerMethod: 'SteamFrame', canPowerOff: true } });
  expect(await current()).toMatchObject({ powerMethod: 'SteamFrame', canPowerOff: true });

  // a busy device clears once the override reports it disconnected
  service.setTurningOff(1, true);
  expect((await current()).isTurningOff).toBe(true);
  service.setOverrides({ C1: { powerMethod: 'SteamFrame', isConnected: false } });
  expect(await current()).toMatchObject({ isConnected: false, isTurningOff: false });

  service.setOverrides({});
  expect(await current()).toMatchObject({ powerMethod: 'None', isConnected: true });
  expect((await current()).canPowerOff).toBeUndefined();
});
