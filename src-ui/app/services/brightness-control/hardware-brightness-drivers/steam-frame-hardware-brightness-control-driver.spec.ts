import { BehaviorSubject, firstValueFrom } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { APP_SETTINGS_DEFAULT } from '../../../models/settings';
import { FrameBrightnessState, FrameState } from '../../../models/frame-pairing';
import { SteamFrameHardwareBrightnessControlDriver } from './steam-frame-hardware-brightness-control-driver';
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
function setup() {
  const brightness: FrameBrightnessState = {
    revision: 1,
    ready: true,
    bounds: { min: 0.005, max: 1.25 },
    applied: 100,
    requested: null,
    accepted: null,
    operation_id: null,
    phase: 'idle',
    progress: 0,
    elapsed_ms: 0,
    error: null,
  };
  const state = {
    pairing_id: 'pair',
    device_manager_id: 'OVR_HMD_synthetic',
    paired: true,
    connected: true,
    in_progress: false,
    brightness_session: 1,
    brightness,
  } as FrameState;
  const states = new BehaviorSubject([state]);
  const devices = new BehaviorSubject([{ class: 'HMD', serialNumber: 'synthetic' }]);
  const driver = new SteamFrameHardwareBrightnessControlDriver(
    new BehaviorSubject(APP_SETTINGS_DEFAULT),
    states,
    { devices, status: new BehaviorSubject('INITIALIZED') } as never
  );
  const update = (patch: Partial<FrameBrightnessState>, extra: Partial<FrameState> = {}) =>
    states.next([{ ...state, ...extra, brightness: { ...brightness, ...patch } }]);
  return { driver, states, devices, state, brightness, update };
}
describe('Frame brightness driver', () => {
  it('requires matching active HMD, authenticated connection and brightness readiness', async () => {
    const h = setup();
    expect(await firstValueFrom(h.driver.isAvailable())).toBe(true);
    h.update({ ready: false });
    expect(await firstValueFrom(h.driver.isAvailable())).toBe(false);
    h.update({}, { connected: false });
    expect(await firstValueFrom(h.driver.isAvailable())).toBe(false);
    h.update({});
    h.devices.next([{ class: 'HMD', serialNumber: 'other' }]);
    expect(await firstValueFrom(h.driver.isAvailable())).toBe(false);
    h.driver.dispose();
  });
  it('does not confirm accepted writes, and propagates failed readback', async () => {
    const h = setup();
    let id = '';
    vi.mocked(invoke).mockImplementationOnce(async (_, args: any) => {
      id = args.command.operation_id;
      return {
        ...h.brightness,
        revision: 2,
        operation_id: id,
        phase: 'accepted',
        accepted: 50,
      } as any;
    });
    const pending = h.driver.setBrightnessPercentage(50);
    const failure = expect(pending).rejects.toBe('write_failed');
    await Promise.resolve();
    expect(await h.driver.getBrightnessPercentage()).toBe(100);
    h.update({ revision: 3, operation_id: id, phase: 'failed', error: 'write_failed' });
    await failure;
    expect(await h.driver.getBrightnessPercentage()).toBe(100);
    h.driver.dispose();
  });
  it('reconciles an accepted transition after disconnect without replaying it', async () => {
    const h = setup();
    let id = '';
    vi.mocked(invoke).mockClear();
    vi.mocked(invoke).mockImplementationOnce(async (_, args: any) => {
      id = args.command.operation_id;
      return { ...h.brightness, revision: 2, operation_id: id, phase: 'accepted' } as any;
    });
    const task = h.driver.transitionBrightness(20, 1000);
    const pending = task.start();
    await Promise.resolve();
    h.update({ revision: 2, operation_id: id, phase: 'running' }, { connected: false });
    h.update(
      { revision: 60, operation_id: id, phase: 'completed', progress: 1, applied: 20 },
      { brightness_session: 2 }
    );
    await pending;
    expect(task.isComplete()).toBe(true);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(await h.driver.getBrightnessPercentage()).toBe(20);
    h.driver.dispose();
  });
  it('fails reconciliation after daemon restart instead of replaying a transition', async () => {
    const h = setup();
    vi.mocked(invoke).mockImplementationOnce(
      async (_, args: any) =>
        ({
          ...h.brightness,
          revision: 20,
          operation_id: args.command.operation_id,
          phase: 'accepted',
        }) as any
    );
    const task = h.driver.transitionBrightness(20, 1000);
    const failure = expect(task.start()).rejects.toBe('stale_operation');
    await Promise.resolve();
    h.update({ revision: 1, operation_id: null }, { brightness_session: 2 });
    await failure;
    h.driver.dispose();
  });
  it('keeps only the newest slider target while a command is in flight', async () => {
    const h = setup();
    vi.mocked(invoke).mockClear();
    let finish!: (value: any) => void;
    vi.mocked(invoke).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    vi.mocked(invoke).mockImplementation(
      async (_, args: any) =>
        ({
          ...h.brightness,
          revision: 3,
          operation_id: args.command.operation_id,
          phase: 'completed',
          applied: args.command.percentage,
        }) as any
    );
    const first = h.driver.setBrightnessPercentage(20);
    const pending = Array.from({ length: 100 }, (_, i) =>
      h.driver.setBrightnessPercentage(20 + i).catch((error) => error)
    );
    expect(invoke).toHaveBeenCalledTimes(1);
    finish({ ...h.brightness, revision: 2, phase: 'completed', applied: 20 });
    await first;
    const results = await Promise.all(pending);
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(vi.mocked(invoke).mock.calls[1][1]).toMatchObject({ command: { percentage: 119 } });
    expect(results.filter((result) => result === 'stale_operation')).toHaveLength(99);
    h.driver.dispose();
  });
  it('drops queued slider samples on disconnect', async () => {
    const h = setup();
    vi.mocked(invoke).mockClear();
    let finish!: (value: any) => void;
    vi.mocked(invoke).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    const first = h.driver.setBrightnessPercentage(20);
    const pending = h.driver.setBrightnessPercentage(80).catch((error) => error);
    h.update({}, { connected: false });
    finish({ ...h.brightness, revision: 2, phase: 'completed', applied: 20 });
    await first;
    expect(await pending).toBe('offline');
    h.update({}, { brightness_session: 2 });
    expect(invoke).toHaveBeenCalledTimes(1);
    h.driver.dispose();
  });
});
