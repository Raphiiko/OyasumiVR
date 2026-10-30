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
    expect(invoke).toHaveBeenCalledWith(command);
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

  it('logs a failed step when Windows refuses the power command', async () => {
    const service = setup('HIBERNATE');
    invoke.mockRejectedValue('hibernation is disabled');
    const sequence = service.runSequence('MANUAL');
    await vi.advanceTimersByTimeAsync(2000);
    await sequence;
    expect(service['eventLog'].logEvent).toHaveBeenLastCalledWith({
      type: 'shutdownSequenceStepFailed',
      step: 'HIBERNATE',
      failure: 'UNKNOWN',
    });
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
    expect(invoke).not.toHaveBeenCalled();
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
    await vi.advanceTimersByTimeAsync(6_000);
    await sequence;

    expect(invoke).not.toHaveBeenCalledWith('windows_sleep');
    await expect(firstValueFrom(service.stage.pipe(take(1)))).resolves.toBe('IDLE');
  });

  it('waits for SteamVR to report it quit after the forced kill', async () => {
    const service = setup('SLEEP', 'INITIALIZED');
    service['config'].quitSteamVR = true;
    const status = service['openvr'].status as unknown as BehaviorSubject<string>;
    const quitting = firstValueFrom(
      service.stage.pipe(
        filter((stage) => stage === 'QUITTING_STEAMVR'),
        take(1)
      )
    );
    const sequence = service.runSequence('MANUAL');
    await quitting;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(invoke).toHaveBeenCalledWith('quit_steamvr', { kill: true });
    await vi.advanceTimersByTimeAsync(1_000);
    status.next('INACTIVE');
    await vi.advanceTimersByTimeAsync(3_000);
    await sequence;

    expect(service['eventLog'].logEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'shutdownSequenceStepFailed', step: 'QUITTING_STEAMVR' })
    );
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

describe('ShutdownAutomationsService base station power-off', () => {
  const baseStation = (id: string, powerState: string) => ({
    id,
    deviceType: 'lighthouseV1',
    powerState,
  });

  function setupBaseStations(
    lighthouseDevices: ReturnType<typeof baseStation>[],
    reached: (id: string) => boolean,
    needsIdentifier: (id: string) => boolean = () => false
  ) {
    const setPowerState = vi.fn(async (device: { id: string }) => reached(device.id));
    const logEvent = vi.fn();
    const service = new ShutdownAutomationsService(
      {} as Dependencies[0],
      {} as Dependencies[1],
      {
        settingsSync: {
          ...APP_SETTINGS_DEFAULT,
          lighthousePowerControl: true,
          lighthousePowerOffState: 'standby',
        },
      } as Dependencies[2],
      { devices: new BehaviorSubject([]) } as unknown as Dependencies[3],
      {} as Dependencies[4],
      {
        devices: new BehaviorSubject(lighthouseDevices),
        setPowerState,
        deviceNeedsIdentifier: (device: { id: string }) => needsIdentifier(device.id),
      } as unknown as Dependencies[5],
      { logEvent } as unknown as Dependencies[6],
      {} as Dependencies[7],
      {} as Dependencies[8],
      {
        getDevicesForSelection: async () => ({
          ovrDevices: [],
          lighthouseDevices,
          knownDevices: [],
        }),
      } as unknown as Dependencies[9]
    );
    service['config'] = {
      ...structuredClone(AUTOMATION_CONFIGS_DEFAULT.SHUTDOWN_AUTOMATIONS),
      turnOffDevices: { devices: [], types: [] } as never,
    };
    return { service, setPowerState, logEvent };
  }

  it('accepts a base station that reached standby as its own off state', async () => {
    const h = setupBaseStations([baseStation('V1', 'on')], () => true);
    const turningOff = h.service['turnOffDevices']();
    await vi.advanceTimersByTimeAsync(2000);
    await turningOff;

    expect(h.setPowerState).toHaveBeenCalledOnce();
    expect(h.logEvent).not.toHaveBeenCalled();
  });

  it('skips base stations that were already off or lack an identifier', async () => {
    const h = setupBaseStations(
      [baseStation('OFF', 'sleep'), baseStation('NO_ID', 'on')],
      () => false,
      (id) => id === 'NO_ID'
    );
    const turningOff = h.service['turnOffDevices']();
    await vi.advanceTimersByTimeAsync(2000);
    await turningOff;

    expect(h.setPowerState).not.toHaveBeenCalled();
    expect(h.logEvent).not.toHaveBeenCalled();
  });

  it('logs a failed step when a commanded base station does not respond', async () => {
    const h = setupBaseStations([baseStation('V1', 'on')], () => false);
    const turningOff = h.service['turnOffDevices']();
    await vi.advanceTimersByTimeAsync(2000);
    await turningOff;

    expect(h.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'shutdownSequenceStepFailed',
        step: 'TURNING_OFF_DEVICES',
        failure: 'BASE_STATION_NO_RESPONSE',
      })
    );
  });
});
