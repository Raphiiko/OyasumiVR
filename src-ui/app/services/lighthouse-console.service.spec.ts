import { BehaviorSubject, firstValueFrom } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSettingsService } from './app-settings.service';
import type { OpenVRService } from './openvr.service';
import { APP_SETTINGS_DEFAULT, type AppSettings } from '../models/settings';
import type { OVRDevice } from '../models/ovr-device';
import { LighthouseConsoleService } from './lighthouse-console.service';

const invoke = vi.hoisted(() => vi.fn());

vi.mock('@tauri-apps/api/core', () => ({ invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock('@tauri-apps/plugin-log', () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }));

const PATH = 'C:\\stub\\lighthouse_console.exe';

const device: OVRDevice = {
  index: 1,
  class: 'Controller',
  serialNumber: 'SERIAL-1',
  dongleId: 'DONGLE-1',
  canPowerOff: true,
  isTurningOff: false,
} as OVRDevice;

async function createService(stdout: string) {
  const settings = new BehaviorSubject<AppSettings>({
    ...APP_SETTINGS_DEFAULT,
    lighthouseConsolePath: '',
  });
  const appSettings = {
    settings: settings.asObservable(),
    updateSettings: vi.fn(),
  } as unknown as AppSettingsService;
  const openvr = {
    devices: new BehaviorSubject<OVRDevice[]>([device]).asObservable(),
    onDeviceUpdate: vi.fn(),
  } as unknown as OpenVRService;
  const service = new LighthouseConsoleService(appSettings, openvr);
  // let the constructor's init() settle before the test drives the service
  await new Promise((resolve) => setTimeout(resolve, 0));
  invoke.mockImplementation(async () => ({ stdout, stderr: '', status: 0 }));
  return service;
}

describe('LighthouseConsoleService.setConsolePath', () => {
  beforeEach(() => invoke.mockReset());

  it('keeps INVALID_EXECUTABLE as the final status for an unexpected banner', async () => {
    const service = await createService('unexpected');
    await service.setConsolePath(PATH, false);
    expect(await firstValueFrom(service.consoleStatus)).toBe('INVALID_EXECUTABLE');
  });

  it('keeps INVALID_EXECUTABLE for empty output', async () => {
    const service = await createService('');
    await service.setConsolePath(PATH, false);
    expect(await firstValueFrom(service.consoleStatus)).toBe('INVALID_EXECUTABLE');
  });

  it('emits no SUCCESS at any point for an unexpected banner', async () => {
    const service = await createService('unexpected');
    const seen: string[] = [];
    const sub = service.consoleStatus.subscribe((s) => seen.push(s));
    await service.setConsolePath(PATH, false);
    sub.unsubscribe();
    expect(seen).not.toContain('SUCCESS');
    expect(seen.at(-1)).toBe('INVALID_EXECUTABLE');
  });

  it('does not run the executable for power-off after a rejected path', async () => {
    const service = await createService('unexpected');
    await service.setConsolePath(PATH, false);
    invoke.mockClear();
    await service.turnOffDevices([device]);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('still reports SUCCESS for a matching banner', async () => {
    const service = await createService('Version:  lighthouse_console.exe 1.0\nmore');
    await service.setConsolePath(PATH, false);
    expect(await firstValueFrom(service.consoleStatus)).toBe('SUCCESS');
  });

  it('recovers to SUCCESS after a rejected path', async () => {
    const service = await createService('unexpected');
    await service.setConsolePath(PATH, false);
    invoke.mockImplementation(async () => ({
      stdout: 'Version:  lighthouse_console.exe 1.0',
      stderr: '',
      status: 0,
    }));
    await service.setConsolePath(PATH, false);
    expect(await firstValueFrom(service.consoleStatus)).toBe('SUCCESS');
  });

  it('runs the executable for power-off once the path is accepted', async () => {
    const service = await createService('Version:  lighthouse_console.exe 1.0');
    await service.setConsolePath(PATH, false);
    invoke.mockClear();
    await service.turnOffDevices([device]);
    expect(invoke).toHaveBeenCalledOnce();
  });

  it('reports NOT_FOUND for a path with the wrong filename', async () => {
    const service = await createService('unexpected');
    await service.setConsolePath('C:\\stub\\other.exe', false);
    expect(await firstValueFrom(service.consoleStatus)).toBe('NOT_FOUND');
  });

  it('leaves the power-off path unused while the status is UNKNOWN', async () => {
    const service = await createService('unexpected');
    invoke.mockClear();
    await service.turnOffDevices([device]);
    expect(invoke).not.toHaveBeenCalled();
  });
});
