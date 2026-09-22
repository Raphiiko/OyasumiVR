import '@angular/compiler';
import { BehaviorSubject, filter, firstValueFrom, take } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTOMATION_CONFIGS_DEFAULT } from '../models/automations';
import { APP_SETTINGS_DEFAULT } from '../models/settings';
import { ShutdownAutomationsService } from './shutdown-automations.service';

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke }));

type Dependencies = ConstructorParameters<typeof ShutdownAutomationsService>;

function setup(
  powerDownWindowsMode: 'SLEEP' | 'HIBERNATE' | 'LOGOUT' = 'SLEEP',
  status = 'INACTIVE'
) {
  const service = new ShutdownAutomationsService(
    {} as Dependencies[0],
    {} as Dependencies[1],
    {
      settingsSync: { ...APP_SETTINGS_DEFAULT, lighthousePowerControl: false },
    } as Dependencies[2],
    {
      status: new BehaviorSubject(status),
      devices: new BehaviorSubject([]),
    } as unknown as Dependencies[3],
    {} as Dependencies[4],
    { devices: new BehaviorSubject([]) } as unknown as Dependencies[5],
    { logEvent: vi.fn() } as unknown as Dependencies[6],
    { translate: (key: string) => key } as Dependencies[7],
    {} as Dependencies[8],
    {} as Dependencies[9]
  );
  service['config'] = {
    ...structuredClone(AUTOMATION_CONFIGS_DEFAULT.SHUTDOWN_AUTOMATIONS),
    quitSteamVR: false,
    powerDownWindows: true,
    powerDownWindowsMode,
  };
  return service;
}

beforeEach(() => {
  vi.useFakeTimers();
  invoke.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.resetAllMocks();
});

describe('ShutdownAutomationsService sequence completion', () => {
  it.each([
    ['SLEEP', 'windows_sleep'],
    ['HIBERNATE', 'windows_hibernate'],
    ['LOGOUT', 'windows_logout'],
  ] as const)('stays active until the delayed %s command is dispatched', async (mode, command) => {
    const service = setup(mode);
    const poweringDown = firstValueFrom(
      service.stage.pipe(
        filter((stage) => stage === 'POWERING_DOWN'),
        take(1)
      )
    );
    const sequence = service.runSequence('MANUAL');
    await poweringDown;

    await vi.advanceTimersByTimeAsync(499);
    expect(invoke).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await sequence;
    expect(invoke).toHaveBeenCalledWith(command);
    await expect(firstValueFrom(service.stage.pipe(take(1)))).resolves.toBe('IDLE');
  });

  it('returns to idle when a sequence step rejects', async () => {
    const service = setup();
    vi.spyOn(service as never, 'turnOffDevices' as never).mockImplementation(() => {
      service['_stage'].next('TURNING_OFF_DEVICES');
      return Promise.reject(new Error('device failure')) as never;
    });

    await expect(service.runSequence('MANUAL')).rejects.toThrow('device failure');
    await expect(firstValueFrom(service.stage.pipe(take(1)))).resolves.toBe('IDLE');
  });

  it('still force-quits SteamVR when the sequence is cancelled while quitting it', async () => {
    const service = setup('SLEEP', 'INITIALIZED');
    service['config'].quitSteamVR = true;
    const quitting = firstValueFrom(
      service.stage.pipe(
        filter((stage) => stage === 'QUITTING_STEAMVR'),
        take(1)
      )
    );
    const sequence = service.runSequence('MANUAL');
    await quitting;
    await vi.advanceTimersByTimeAsync(0);
    await service.cancelSequence('MANUAL');
    await vi.advanceTimersByTimeAsync(4_999);
    expect(invoke).not.toHaveBeenCalledWith('quit_steamvr', { kill: true });
    await vi.advanceTimersByTimeAsync(1);
    expect(invoke).toHaveBeenCalledWith('quit_steamvr', { kill: true });
    await vi.advanceTimersByTimeAsync(1_000);
    await sequence;

    expect(invoke).not.toHaveBeenCalledWith('windows_sleep');
    await expect(firstValueFrom(service.stage.pipe(take(1)))).resolves.toBe('IDLE');
  });

  it('does not dispatch a delayed power command after cancellation', async () => {
    const service = setup();
    const poweringDown = firstValueFrom(
      service.stage.pipe(
        filter((stage) => stage === 'POWERING_DOWN'),
        take(1)
      )
    );
    const sequence = service.runSequence('MANUAL');
    await poweringDown;
    await service.cancelSequence('MANUAL');
    await sequence;

    expect(invoke).not.toHaveBeenCalledWith('windows_sleep');
    await expect(firstValueFrom(service.stage.pipe(take(1)))).resolves.toBe('IDLE');
  });
});
