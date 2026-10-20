import '@angular/compiler';
import { BehaviorSubject, filter, firstValueFrom, take } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTOMATION_CONFIGS_DEFAULT } from '../models/automations';
import { APP_SETTINGS_DEFAULT } from '../models/settings';
import type { OVRDevice } from '../models/ovr-device';
import { ShutdownAutomationsService } from './shutdown-automations.service';

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
vi.mock('@tauri-apps/plugin-log', () => ({ warn: vi.fn() }));

type Dependencies = ConstructorParameters<typeof ShutdownAutomationsService>;

function setup(
  powerDownWindowsMode: 'SHUTDOWN' | 'REBOOT' | 'SLEEP' | 'HIBERNATE' | 'LOGOUT' = 'SLEEP',
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
    {
      getDevicesForSelection: async () => ({
        ovrDevices: [],
        lighthouseDevices: [],
        knownDevices: [],
      }),
    } as unknown as Dependencies[9]
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
    expect(invoke).toHaveBeenCalledWith(command, undefined);
    await expect(firstValueFrom(service.stage.pipe(take(1)))).resolves.toBe('IDLE');
  });

  it.each([
    ['SHUTDOWN', 'windows_shutdown'],
    ['REBOOT', 'windows_reboot'],
  ] as const)('returns to idle at once when Windows refuses %s', async (mode, command) => {
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === command) throw 'refused';
    });
    const service = setup(mode);

    const sequence = service.runSequence('MANUAL');
    await vi.advanceTimersByTimeAsync(2000);
    await sequence;

    expect(invoke).toHaveBeenCalledWith(command, expect.anything());
    await expect(firstValueFrom(service.stage.pipe(take(1)))).resolves.toBe('IDLE');
  });

  it('completes the sequence when Windows refuses a delayed power command', async () => {
    invoke.mockRejectedValue('refused');
    const service = setup('SLEEP');

    const sequence = service.runSequence('MANUAL');
    await vi.advanceTimersByTimeAsync(2000);

    await expect(sequence).resolves.toBeUndefined();
    await expect(firstValueFrom(service.stage.pipe(take(1)))).resolves.toBe('IDLE');
  });

  it('ignores a second start while the first run looks up its devices', async () => {
    const service = setup();
    const first = service.runSequence('MANUAL');
    const second = service.runSequence('MANUAL');
    expect(service['eventLog'].logEvent).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2000);
    await Promise.all([first, second]);
    expect(invoke.mock.calls.filter(([command]) => command === 'windows_sleep')).toHaveLength(1);
  });

  it('cancels a run that is still looking up its devices', async () => {
    const service = setup();
    const sequence = service.runSequence('MANUAL');
    await service.cancelSequence('MANUAL');
    await vi.advanceTimersByTimeAsync(2000);
    await sequence;
    expect(invoke).not.toHaveBeenCalledWith('windows_sleep');
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

describe('ShutdownAutomationsService device power-off', () => {
  const controller = {
    index: 1,
    class: 'Controller',
    serialNumber: 'C1',
    canPowerOff: true,
    isConnected: true,
    isTurningOff: false,
  } as OVRDevice;

  function setupPowerOff(initial: OVRDevice[]) {
    const devices = new BehaviorSubject<OVRDevice[]>(initial);
    const turnOffDevices = vi.fn(async () => devices.value);
    // resolves the selection against the devices as they are when the sequence runs
    const getDevicesForSelection = vi.fn(async () => ({
      ovrDevices: devices.value,
      lighthouseDevices: [],
      knownDevices: [],
    }));
    const service = new ShutdownAutomationsService(
      {} as Dependencies[0],
      {} as Dependencies[1],
      {
        settingsSync: { ...APP_SETTINGS_DEFAULT, lighthousePowerControl: false },
      } as Dependencies[2],
      { devices } as unknown as Dependencies[3],
      { turnOffDevices } as unknown as Dependencies[4],
      {} as Dependencies[5],
      {} as Dependencies[6],
      {} as Dependencies[7],
      {} as Dependencies[8],
      { getDevicesForSelection } as unknown as Dependencies[9]
    );
    return { service, devices, turnOffDevices };
  }

  it('turns off devices that were off when the selection was made', async () => {
    const h = setupPowerOff([{ ...controller, canPowerOff: false, isConnected: false }]);
    h.devices.next([controller]);
    void h.service['turnOffDevices']();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.turnOffDevices).toHaveBeenCalledWith([controller]);
  });

  it('waits for the devices to disconnect, not to lose power control', async () => {
    const h = setupPowerOff([controller]);
    let done = false;
    const turningOff = h.service['turnOffDevices']().then(() => (done = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(h.turnOffDevices).toHaveBeenCalledWith([controller]);

    h.devices.next([{ ...controller, canPowerOff: false }]);
    await vi.advanceTimersByTimeAsync(2000);
    expect(done).toBe(false);

    h.devices.next([{ ...controller, canPowerOff: false, isConnected: false }]);
    await vi.advanceTimersByTimeAsync(250 + 1000);
    await turningOff;
    expect(done).toBe(true);
  });
});
