import { BehaviorSubject, firstValueFrom } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AUTOMATION_CONFIGS_DEFAULT,
  type MSIAfterburnerAutomationConfig,
} from '../models/automations';
import { APP_SETTINGS_DEFAULT, type AppSettings } from '../models/settings';
import type { OVRDevice } from '../models/ovr-device';
import { LighthouseConsoleService } from './lighthouse-console.service';
import { GpuAutomationsService } from './gpu-automations.service';

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock('@tauri-apps/plugin-log', () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }));

function deferred() {
  let resolve!: (value: unknown) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createLighthouse() {
  vi.spyOn(LighthouseConsoleService.prototype, 'init').mockResolvedValue();
  const settings = new BehaviorSubject({ ...APP_SETTINGS_DEFAULT });
  const device = { index: 1, serialNumber: 'S1', dongleId: 'D1', canPowerOff: true } as OVRDevice;
  const service = new LighthouseConsoleService(
    {
      settings,
      updateSettings: (patch: Partial<AppSettings>) =>
        settings.next({ ...settings.value, ...patch }),
    } as unknown as ConstructorParameters<typeof LighthouseConsoleService>[0],
    {
      devices: new BehaviorSubject([device]),
      onDeviceUpdate: vi.fn(),
    } as unknown as ConstructorParameters<typeof LighthouseConsoleService>[1]
  );
  return {
    filename: 'lighthouse_console.exe',
    success: { stdout: 'Version:  lighthouse_console.exe 1.0' },
    failure: 'NOT_FOUND',
    set: (path: string) => service.setConsolePath(path),
    status: service.consoleStatus,
    configure: (path: string) => settings.next({ ...settings.value, lighthouseConsolePath: path }),
    act: () => service.turnOffDevices([device]),
    actionCall: (path: string) => [
      'run_command',
      { command: path, args: ['/serial', 'D1', 'poweroff'] },
    ],
  };
}

function createMSI() {
  const configs = new BehaviorSubject(structuredClone(AUTOMATION_CONFIGS_DEFAULT));
  const configure = (path: string) =>
    configs.next({
      ...configs.value,
      MSI_AFTERBURNER: { ...configs.value.MSI_AFTERBURNER, msiAfterburnerPath: path },
    });
  const service = new GpuAutomationsService(
    {
      configs,
      updateAutomationConfig: async (
        _key: string,
        patch: Partial<MSIAfterburnerAutomationConfig>
      ) => configure(patch.msiAfterburnerPath!),
    } as unknown as ConstructorParameters<typeof GpuAutomationsService>[0],
    {} as ConstructorParameters<typeof GpuAutomationsService>[1],
    {} as ConstructorParameters<typeof GpuAutomationsService>[2],
    {} as ConstructorParameters<typeof GpuAutomationsService>[3],
    { logEvent: vi.fn() } as unknown as ConstructorParameters<typeof GpuAutomationsService>[4]
  );
  return {
    filename: 'MSIAfterburner.exe',
    success: true,
    failure: 'ExeNotFound',
    set: (path: string) => service.setMSIAfterburnerPath(path),
    status: service.msiAfterburnerStatus,
    configure,
    act: () => service.setMSIAfterburnerProfile(1, 'SLEEP_MODE_ENABLED'),
    actionCall: (path: string) => [
      'msi_afterburner_set_profile',
      { executablePath: path, profile: 1 },
    ],
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  invoke.mockReset();
});

describe.each([
  ['lighthouse', createLighthouse],
  ['MSI', createMSI],
] as const)('%s executable validation', (_name, create) => {
  it.each([true, false])(
    'keeps the newest failure when the older probe finishes first: %s',
    async (olderFirst) => {
      const harness = create();
      const older = deferred();
      const newer = deferred();
      invoke.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
      const first = harness.set(`C:\\old\\${harness.filename}`);
      await Promise.resolve();
      const second = harness.set(`C:\\new\\${harness.filename}`);
      await Promise.resolve();
      if (olderFirst) {
        older.resolve(harness.success);
        await first;
        expect(await firstValueFrom(harness.status)).toBe('CHECKING');
      }
      newer.reject(harness.failure);
      await second;
      if (!olderFirst) {
        older.resolve(harness.success);
        await first;
      }
      expect(await firstValueFrom(harness.status)).toBe('NOT_FOUND');
      invoke.mockClear();
      await harness.act();
      expect(invoke).not.toHaveBeenCalled();
    }
  );

  it.each([true, false])(
    'keeps the newest success when the older probe finishes first: %s',
    async (olderFirst) => {
      const harness = create();
      const older = deferred();
      const newer = deferred();
      const path = `C:\\new\\${harness.filename}`;
      invoke.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
      const first = harness.set(`C:\\old\\${harness.filename}`);
      await Promise.resolve();
      const second = harness.set(path);
      await Promise.resolve();
      if (olderFirst) {
        older.reject(harness.failure);
        await first;
        expect(await firstValueFrom(harness.status)).toBe('CHECKING');
      }
      newer.resolve(harness.success);
      await second;
      if (!olderFirst) {
        older.reject(harness.failure);
        await first;
      }
      expect(await firstValueFrom(harness.status)).toBe('SUCCESS');
      invoke.mockClear();
      invoke.mockResolvedValue(harness.success);
      await harness.act();
      expect(invoke.mock.calls).toEqual([harness.actionCall(path)]);
    }
  );

  it('blocks actions while a replacement validation is pending', async () => {
    const harness = create();
    invoke.mockResolvedValue(harness.success);
    await harness.set(`C:\\old\\${harness.filename}`);
    const pending = deferred();
    invoke.mockReturnValueOnce(pending.promise);
    const validation = harness.set(`C:\\new\\${harness.filename}`);
    await Promise.resolve();
    invoke.mockClear();
    await harness.act();
    expect(invoke).not.toHaveBeenCalled();
    pending.resolve(harness.success);
    await validation;
  });

  it('does not authorize a configured path that has not been validated', async () => {
    const harness = create();
    invoke.mockResolvedValue(harness.success);
    await harness.set(`C:\\old\\${harness.filename}`);
    harness.configure(`C:\\new\\${harness.filename}`);
    invoke.mockClear();
    await harness.act();
    expect(invoke).not.toHaveBeenCalled();
  });
});

it('does not let an old MSI profile failure replace a newer validation', async () => {
  const harness = createMSI();
  invoke.mockResolvedValue(true);
  await harness.set('C:\\old\\MSIAfterburner.exe');
  const pending = deferred();
  invoke.mockReturnValueOnce(pending.promise);
  const action = harness.act();
  await harness.set('C:\\new\\MSIAfterburner.exe');
  pending.reject('ExeNotFound');
  await action;
  expect(await firstValueFrom(harness.status)).toBe('SUCCESS');
});
