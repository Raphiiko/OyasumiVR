import '@angular/compiler';
import { BehaviorSubject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { AUTOMATION_CONFIGS_DEFAULT } from '../models/automations';
import { ShutdownAutomationsService } from './shutdown-automations.service';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));

type Dependencies = ConstructorParameters<typeof ShutdownAutomationsService>;
const invokeMock = vi.mocked(invoke);

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function setup(mode: 'SHUTDOWN' | 'SLEEP' = 'SLEEP') {
  const eventLog = { logEvent: vi.fn() };
  const service = new ShutdownAutomationsService(
    { mode: new BehaviorSubject(false) } as unknown as Dependencies[0],
    {} as Dependencies[1],
    {} as Dependencies[2],
    {} as Dependencies[3],
    {} as Dependencies[4],
    {} as Dependencies[5],
    eventLog as unknown as Dependencies[6],
    { translate: vi.fn((key: string) => key) } as unknown as Dependencies[7],
    {} as Dependencies[8],
    {} as Dependencies[9]
  );
  service['config'] = {
    ...structuredClone(AUTOMATION_CONFIGS_DEFAULT.SHUTDOWN_AUTOMATIONS),
    quitSteamVR: false,
    powerDownWindows: true,
    powerDownWindowsMode: mode,
  };
  return { service, eventLog };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.clearAllMocks();
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('shutdown sequence completion', () => {
  it('returns one promise for overlapping starts', async () => {
    const command = deferred();
    invokeMock.mockReturnValue(command.promise);
    const { service, eventLog } = setup();

    const first = service.runSequence('MANUAL');
    const second = service.runSequence('HOTKEY');

    expect(second).toBe(first);
    expect(service.waitForCurrentSequence()).toBe(first);
    await vi.advanceTimersByTimeAsync(0);
    expect(eventLog.logEvent).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(500);
    expect(invokeMock).toHaveBeenCalledOnce();
    command.resolve();
    await first;
    await expect(service.waitForCurrentSequence()).resolves.toBeUndefined();
  });

  it('includes the delayed power command in completion', async () => {
    const command = deferred();
    invokeMock.mockReturnValue(command.promise);
    const { service } = setup();
    const completed = vi.fn();

    const sequence = service.runSequence('MANUAL').then(completed);
    await vi.advanceTimersByTimeAsync(499);
    expect(invokeMock).not.toHaveBeenCalled();
    expect(completed).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(invokeMock).toHaveBeenCalledWith('windows_sleep');
    expect(completed).not.toHaveBeenCalled();
    command.resolve();
    await sequence;
    expect(completed).toHaveBeenCalledOnce();
  });

  it('waits for shutdown cancellation before completing', async () => {
    const cancellation = deferred();
    invokeMock.mockImplementation((command) => {
      if (command === 'run_command') return cancellation.promise;
      return Promise.resolve();
    });
    const { service } = setup('SHUTDOWN');
    const completed = vi.fn();

    const sequence = service.runSequence('MANUAL').then(completed);
    await vi.advanceTimersByTimeAsync(0);
    expect(invokeMock).toHaveBeenCalledWith('windows_shutdown', expect.any(Object));
    const cancel = service.cancelSequence('MANUAL');
    await vi.advanceTimersByTimeAsync(0);
    expect(invokeMock).toHaveBeenCalledWith('run_command', {
      command: 'shutdown',
      args: ['/a'],
    });
    expect(completed).not.toHaveBeenCalled();
    cancellation.resolve();
    await cancel;
    await sequence;
    expect(completed).toHaveBeenCalledOnce();
  });

  it('does not dispatch a delayed power command after cancellation', async () => {
    invokeMock.mockResolvedValue(undefined);
    const { service } = setup();

    const sequence = service.runSequence('MANUAL');
    await vi.advanceTimersByTimeAsync(0);
    const cancel = service.cancelSequence('MANUAL');
    await vi.advanceTimersByTimeAsync(500);
    await cancel;
    await sequence;

    expect(invokeMock).toHaveBeenCalledOnce();
    expect(invokeMock).toHaveBeenCalledWith('run_command', {
      command: 'shutdown',
      args: ['/a'],
    });
  });

  it('cleans up after a power command error', async () => {
    invokeMock.mockRejectedValueOnce(new Error('sleep failed')).mockResolvedValue(undefined);
    const { service } = setup();

    const failed = service.runSequence('MANUAL');
    const rejection = expect(failed).rejects.toThrow('sleep failed');
    await vi.advanceTimersByTimeAsync(500);
    await rejection;
    expect(service['_stage'].value).toBe('IDLE');

    const retry = service.runSequence('MANUAL');
    await vi.advanceTimersByTimeAsync(500);
    await expect(retry).resolves.toBeUndefined();
    expect(invokeMock).toHaveBeenCalledTimes(2);
  });

  it('waits for every lighthouse command when one fails', async () => {
    const failed = deferred();
    const pending = deferred();
    const setPowerState = vi
      .fn()
      .mockReturnValueOnce(failed.promise)
      .mockReturnValueOnce(pending.promise);
    const { service } = setup();
    service['config'].powerDownWindows = false;
    service['turnOffKnownDevices'] = [{}] as never;
    service['turnOffLighthouseDevices'] = [
      { id: 'A', powerState: 'on' },
      { id: 'B', powerState: 'on' },
    ] as never;
    service['appSettings'] = {
      settingsSync: { lighthousePowerControl: true, lighthousePowerOffState: 'sleep' },
    } as Dependencies[2];
    service['lighthouse'] = { setPowerState } as unknown as Dependencies[5];
    const settled = vi.fn();

    const sequence = service.runSequence('MANUAL');
    const rejection = expect(sequence).rejects.toThrow('first failed');
    sequence.then(settled, settled);
    await vi.advanceTimersByTimeAsync(0);
    failed.reject(new Error('first failed'));
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).not.toHaveBeenCalled();
    pending.resolve();
    await rejection;
    expect(settled).toHaveBeenCalledOnce();
    expect(setPowerState).toHaveBeenCalledTimes(2);
  });
});
