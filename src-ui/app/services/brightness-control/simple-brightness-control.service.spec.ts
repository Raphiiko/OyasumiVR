import { invoke } from '@tauri-apps/api/core';
import { BehaviorSubject, firstValueFrom, ReplaySubject, Subject } from 'rxjs';
import { describe, expect, it, vi, onTestFinished } from 'vitest';
import { AUTOMATION_CONFIGS_DEFAULT } from '../../models/automations';
import type {
  SteamFrameConnectionState,
  SteamFrameFadeEnded,
  SteamFrameFadeOutcome,
} from '../../models/steam-frame';
import { SteamFrameBrightnessFade } from '../steam-frame/steam-frame-fade-task';
import type { HardwareBrightnessFadeOptions } from './hardware-brightness-drivers/hardware-brightness-control-driver';
import { SimpleBrightnessControlService } from './simple-brightness-control.service';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => undefined) }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock('@tauri-apps/plugin-log', () => ({ info: vi.fn(), warn: vi.fn() }));
type Dependencies = ConstructorParameters<typeof SimpleBrightnessControlService>;

async function setup(advancedMode = false, pushesBrightnessChanges = false) {
  const configs = new BehaviorSubject({
    ...structuredClone(AUTOMATION_CONFIGS_DEFAULT),
    BRIGHTNESS_AUTOMATIONS: { ...AUTOMATION_CONFIGS_DEFAULT.BRIGHTNESS_AUTOMATIONS, advancedMode },
  });
  const hardware = {
    driverIsAvailable: new BehaviorSubject(false),
    brightnessBounds: new BehaviorSubject([20, 100]),
    adoptedBrightness: new ReplaySubject<{ percentage: number; bounds: [number, number] }>(1),
    activeDriver: (pushesBrightnessChanges
      ? { pushesBrightnessChanges: true, getBrightnessBounds: () => [20, 100], fade: () => null }
      : null) as {
      pushesBrightnessChanges: boolean;
    } | null,
    onDriverChange: new Subject<void>(),
    setBrightness: vi.fn<Dependencies[1]['setBrightness']>().mockResolvedValue(undefined),
    cancelActiveTransition: vi.fn(),
  };
  const software = {
    brightness: 100,
    setBrightness: vi.fn<Dependencies[2]['setBrightness']>(async (percentage: number) => {
      software.brightness = percentage;
    }),
    cancelActiveTransition: vi.fn(),
  };
  const service = new SimpleBrightnessControlService(
    { configs } as unknown as Dependencies[0],
    hardware as unknown as Dependencies[1],
    software as unknown as Dependencies[2]
  );
  const cancel = vi.spyOn(service, 'cancelActiveTransition');
  await service.init();
  const mode = (value: boolean) =>
    configs.next({
      ...configs.value,
      BRIGHTNESS_AUTOMATIONS: { ...configs.value.BRIGHTNESS_AUTOMATIONS, advancedMode: value },
    });
  // a driver that does not push matches exactly while it is available
  const index = (available: boolean) => {
    hardware.activeDriver = available ? { pushesBrightnessChanges: false } : null;
    hardware.driverIsAvailable.next(available);
  };
  return { configs, hardware, software, service, cancel, mode, index };
}

describe('simple brightness mode changes', () => {
  it('reapplies the stored value exactly once when returning from advanced mode', async () => {
    const h = await setup();
    await h.service.setBrightness(40);
    h.mode(true);
    await h.software.setBrightness(80);
    h.software.setBrightness.mockClear();
    h.mode(false);
    await Promise.resolve();
    h.mode(false);
    expect(h.software.setBrightness).toHaveBeenCalledExactlyOnceWith(40, {
      cancelActiveTransition: true,
      logReason: null,
    });
    expect(h.service.brightness).toBe(40);
    expect(h.hardware.cancelActiveTransition).toHaveBeenCalledTimes(2);
    expect(h.software.cancelActiveTransition).toHaveBeenCalledTimes(2);
  });

  it.each([false, true])('ignores unrelated edits while advanced mode is %s', async (advanced) => {
    const h = await setup(advanced);
    h.configs.next({
      ...h.configs.value,
      DEVICE_POWER_AUTOMATIONS: {
        ...h.configs.value.DEVICE_POWER_AUTOMATIONS,
        enabled: !h.configs.value.DEVICE_POWER_AUTOMATIONS.enabled,
      },
    });
    h.mode(advanced);
    expect(h.cancel).not.toHaveBeenCalled();
    expect(h.hardware.cancelActiveTransition).not.toHaveBeenCalled();
    expect(h.software.cancelActiveTransition).not.toHaveBeenCalled();
    expect(h.software.setBrightness).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    'initializes advanced mode %s without applying brightness',
    async (advanced) => {
      const h = await setup(advanced);
      expect(await firstValueFrom(h.service.advancedMode)).toBe(advanced);
      expect(h.cancel).not.toHaveBeenCalled();
      expect(h.software.setBrightness).not.toHaveBeenCalled();
    }
  );

  it('preserves hardware availability mapping in simple mode', async () => {
    const h = await setup();
    await h.service.setBrightness(40);
    h.index(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(h.software.setBrightness).toHaveBeenLastCalledWith(100, expect.anything());
    expect(h.hardware.setBrightness).toHaveBeenLastCalledWith(40, expect.anything());
    h.mode(true);
    h.hardware.setBrightness.mockClear();
    h.software.setBrightness.mockClear();
    h.index(false);
    await Promise.resolve();
    expect(h.software.setBrightness).not.toHaveBeenCalled();
    expect(h.hardware.setBrightness).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    'discards a pending restore after mode changes, including return to simple: %s',
    async (returnToSimple) => {
      const h = await setup();
      h.index(true);
      await new Promise((resolve) => setTimeout(resolve, 0));
      await h.service.setBrightness(40);
      h.mode(true);
      let finish!: () => void;
      h.software.setBrightness.mockImplementationOnce(
        () => new Promise<void>((resolve) => (finish = resolve))
      );
      h.mode(false);
      await new Promise((resolve) => setTimeout(resolve, 0));
      h.mode(true);
      await h.hardware.setBrightness(80);
      if (returnToSimple) {
        h.mode(false);
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      h.hardware.setBrightness.mockClear();
      finish();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(h.hardware.setBrightness).not.toHaveBeenCalled();
    }
  );

  it('discards a restore that was waiting for hardware bounds', async () => {
    const h = await setup();
    h.index(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    h.mode(true);
    const bounds = new Subject<number[]>();
    h.hardware.brightnessBounds = bounds as BehaviorSubject<number[]>;
    h.software.setBrightness.mockClear();
    h.hardware.setBrightness.mockClear();
    h.mode(false);
    h.mode(true);
    bounds.next([20, 100]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(h.software.setBrightness).not.toHaveBeenCalled();
    expect(h.hardware.setBrightness).not.toHaveBeenCalled();
  });
});

describe('simple brightness with a device that reports its brightness', () => {
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  async function reporting() {
    const h = await setup(false, true);
    h.hardware.brightnessBounds.next([9, 125]);
    h.hardware.driverIsAvailable.next(true);
    await settle();
    h.software.setBrightness.mockClear();
    return h;
  }

  it('derives the value from hardware at the minimum and keeps software dimming', async () => {
    const h = await reporting();
    h.software.brightness = 50;
    h.hardware.adoptedBrightness.next({ percentage: 9, bounds: [9, 125] });
    await settle();
    expect(h.service.brightness).toBe(4.5);
    expect(h.software.setBrightness).not.toHaveBeenCalled();
  });

  it('derives the value from hardware above the minimum and clears software dimming', async () => {
    const h = await reporting();
    h.software.brightness = 50;
    h.hardware.adoptedBrightness.next({ percentage: 67, bounds: [9, 125] });
    await settle();
    expect(h.service.brightness).toBeCloseTo(9 + (58 / 116) * 91);
    expect(h.software.setBrightness).toHaveBeenCalledExactlyOnceWith(100, expect.anything());
    h.hardware.adoptedBrightness.next({ percentage: 125, bounds: [9, 125] });
    await settle();
    expect(h.service.brightness).toBe(100);
    expect(h.software.setBrightness).toHaveBeenCalledOnce();
  });

  it('ignores reports in advanced mode', async () => {
    const h = await reporting();
    h.mode(true);
    h.hardware.adoptedBrightness.next({ percentage: 67, bounds: [9, 125] });
    await settle();
    expect(h.service.brightness).toBe(100);
  });

  it('writes nothing when the driver becomes available or unavailable', async () => {
    const h = await setup(false, true);
    const frame = h.hardware.activeDriver;
    h.hardware.activeDriver = null;
    await h.service.setBrightness(40);
    h.hardware.activeDriver = frame;
    h.software.setBrightness.mockClear();
    h.hardware.driverIsAvailable.next(true);
    await settle();
    h.hardware.driverIsAvailable.next(false);
    await settle();
    expect(h.software.setBrightness).not.toHaveBeenCalled();
    expect(h.hardware.setBrightness).not.toHaveBeenCalled();
    expect(h.service.brightness).toBe(40);
    expect(h.software.brightness).toBe(40);
  });

  it('ignores reports while a simple change is being applied', async () => {
    const h = await reporting();
    let finishSoftware!: () => void;
    h.software.setBrightness.mockImplementationOnce(
      (percentage: number) =>
        new Promise<void>((resolve) => {
          finishSoftware = () => {
            h.software.brightness = percentage;
            resolve();
          };
        })
    );
    const change = h.service.setBrightness(5);
    await settle();
    h.hardware.adoptedBrightness.next({ percentage: 20, bounds: [9, 125] });
    await settle();
    finishSoftware();
    await change;
    expect(h.software.setBrightness).toHaveBeenCalledOnce();
    expect(h.software.brightness).toBeCloseTo((5 / 9) * 100);
    expect(h.service.brightness).toBe(5);
  });

  it('runs a PC transition for a pushing device that is not a Frame', async () => {
    const h = await reporting();
    h.service.transitionBrightness(50, 200, { logReason: 'AT_SUNSET' });
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(h.hardware.setBrightness.mock.calls.length).toBeGreaterThan(2);
    expect(invoke).not.toHaveBeenCalledWith('steam_frame_fade', expect.anything());
  });

  it('gives the simple value to a device that takes over from a pushing one', async () => {
    const h = await reporting();
    h.hardware.onDriverChange.next();
    await h.service.setBrightness(60);
    h.software.setBrightness.mockClear();
    h.hardware.setBrightness.mockClear();
    // a Beyond that stayed available takes over; availability never turns false
    h.hardware.activeDriver = { pushesBrightnessChanges: false };
    h.hardware.onDriverChange.next();
    await settle();
    expect(h.hardware.setBrightness).toHaveBeenCalledOnce();
    expect(h.service.brightness).toBe(60);
  });

  it('ignores a replayed report once the pushing device is gone', async () => {
    const h = await reporting();
    h.hardware.activeDriver = null;
    h.software.brightness = 50;
    h.hardware.adoptedBrightness.next({ percentage: 67, bounds: [9, 125] });
    await settle();
    expect(h.service.brightness).toBe(100);
    expect(h.software.setBrightness).not.toHaveBeenCalled();
  });
});

describe('simple brightness fading a Steam Frame', () => {
  const wait = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

  async function frame() {
    const h = await setup();
    const connections = new BehaviorSubject<Record<string, SteamFrameConnectionState>>({
      p: {
        pairingId: 'p',
        status: 'connected',
        brightness: { runtime: true, supported: true, min: 9, max: 125, percentage: 100 },
      } as SteamFrameConnectionState,
    });
    const fadeEnded = new Subject<SteamFrameFadeEnded>();
    const activePairing = new BehaviorSubject<string | null | undefined>('p');
    const driver = {
      pushesBrightnessChanges: true,
      getBrightnessBounds: () => [9, 125] as [number, number],
      fade: (o: HardwareBrightnessFadeOptions) =>
        new SteamFrameBrightnessFade(
          o.shownTarget,
          {
            pairingId: 'p',
            control: 'brightness',
            target: o.target,
            durationMs: o.durationMs,
            simple: o.simple,
          },
          { connections$: connections, fadeEnded$: fadeEnded, activePairing$: activePairing },
          o.onAccept
        ),
    };
    h.hardware.activeDriver = driver;
    h.hardware.brightnessBounds.next([9, 125]);
    h.hardware.driverIsAvailable.next(true);
    await wait();
    h.software.setBrightness.mockClear();
    h.hardware.setBrightness.mockClear();
    vi.mocked(invoke).mockClear();
    const sent = () => {
      const call = vi.mocked(invoke).mock.calls.find(([name]) => name === 'steam_frame_fade');
      return (call?.[1] as { request: Record<string, unknown> & { operation: string } })?.request;
    };
    const end = (outcome: SteamFrameFadeOutcome) =>
      fadeEnded.next({
        pairingId: 'p',
        control: 'brightness',
        operation: sent().operation,
        outcome,
      });
    return { ...h, sent, end, activePairing };
  }

  it('cancels the fade when another headset takes over', async () => {
    const h = await frame();
    h.service.transitionBrightness(0, 10000);
    await wait();
    h.activePairing.next(null);
    await wait();
    expect(vi.mocked(invoke).mock.calls.map(([name]) => name)).toContain('steam_frame_cancel_fade');
    expect(await firstValueFrom(h.service.activeTransition)).toBeUndefined();
  });

  it('keeps the fade when the same driver returns after a gap without any', async () => {
    const h = await frame();
    const driver = h.hardware.activeDriver;
    h.hardware.onDriverChange.next();
    const task = h.service.transitionBrightness(0, 10000);
    await wait();
    h.hardware.activeDriver = null;
    h.hardware.onDriverChange.next();
    h.hardware.activeDriver = driver;
    h.hardware.onDriverChange.next();
    await wait();
    expect(vi.mocked(invoke).mock.calls.map(([name]) => name)).not.toContain(
      'steam_frame_cancel_fade'
    );
    expect(await firstValueFrom(h.service.activeTransition)).toBe(task);
    task.cancel();
  });

  it('sets the target, software part included, when the helper refuses the fade', async () => {
    const h = await frame();
    const accept = vi.mocked(invoke).getMockImplementation()!;
    onTestFinished(() => void vi.mocked(invoke).mockImplementation(accept));
    vi.mocked(invoke).mockImplementation(async (command, args) => {
      if (command === 'steam_frame_fade') throw 'offline';
      return accept(command, args);
    });
    h.service.transitionBrightness(0, 10000);
    await wait();
    await wait();
    expect(h.service.brightness).toBe(0);
    expect(h.software.brightness).toBe(0);
    expect(h.hardware.setBrightness).toHaveBeenCalled();
    expect(await firstValueFrom(h.service.activeTransition)).toBeUndefined();
  });

  it('fades hardware on the helper and software on this PC along one curve', async () => {
    const h = await frame();
    const task = h.service.transitionBrightness(0, 200, { logReason: 'AT_SUNSET' });
    await wait();
    const { operation: _, ...request } = h.sent();
    expect(request).toEqual({
      control: 'brightness',
      target: 9,
      durationMs: 200,
      simple: { from: 100, to: 0 },
    });
    await wait(260);
    expect(h.software.brightness).toBe(0);
    expect(h.service.brightness).toBe(0);
    expect(h.hardware.setBrightness).not.toHaveBeenCalled();
    h.end('completed');
    await wait();
    expect(task.isComplete()).toBe(true);
    expect(await firstValueFrom(h.service.activeTransition)).toBeUndefined();
  });

  it('stops the software part and adopts the headset after a headset change', async () => {
    const h = await frame();
    h.service.transitionBrightness(0, 10_000, { logReason: 'AT_SUNSET' });
    await wait(50);
    // skipped while the fade runs
    h.hardware.adoptedBrightness.next({ percentage: 67, bounds: [9, 125] });
    await wait();
    expect(h.service.brightness).toBeGreaterThan(99);
    h.end('externalChange');
    await wait();
    expect(h.service.brightness).toBeCloseTo(9 + (58 / 116) * 91);
    expect(h.software.brightness).toBe(100);
    const calls = h.software.setBrightness.mock.calls.length;
    await wait(50);
    expect(h.software.setBrightness.mock.calls.length).toBe(calls);
  });

  it('stops the software part where it is on standby', async () => {
    const h = await frame();
    h.service.transitionBrightness(0, 400, { logReason: 'AT_SUNSET' });
    await wait(200);
    h.end('standby');
    await wait();
    const stopped = h.service.brightness;
    const calls = h.software.setBrightness.mock.calls.length;
    expect(stopped).toBeGreaterThan(0);
    expect(stopped).toBeLessThan(100);
    await wait(300);
    expect(h.service.brightness).toBe(stopped);
    expect(h.software.setBrightness.mock.calls.length).toBe(calls);
    expect(await firstValueFrom(h.service.activeTransition)).toBeUndefined();
  });

  it('ends the software part on its target when the helper completes first', async () => {
    const h = await frame();
    h.service.transitionBrightness(0, 10_000, { logReason: 'AT_SUNSET' });
    await wait(50);
    h.end('completed');
    await wait();
    expect(h.service.brightness).toBe(0);
    expect(h.software.brightness).toBe(0);
    await h.service.setBrightness(70);
    await wait(100);
    expect(h.service.brightness).toBe(70);
  });

  it('never lets a software part that ended mid-write write its final target', async () => {
    const h = await frame();
    let release!: () => void;
    let calls = 0;
    const write = h.software.setBrightness.getMockImplementation()!;
    h.software.setBrightness.mockImplementation((...args) =>
      ++calls === 1 ? new Promise<void>((resolve) => (release = resolve)) : write(...args)
    );
    h.service.transitionBrightness(0, 100);
    await wait(40);
    h.end('completed');
    await wait(120);
    await h.service.setBrightness(70);
    release();
    await wait(50);
    expect(h.service.brightness).toBe(70);
  });

  it('skips the hardware write of an older set once a helper fade starts', async () => {
    const h = await frame();
    let release!: () => void;
    h.software.setBrightness.mockImplementationOnce(
      () => new Promise<void>((resolve) => (release = resolve))
    );
    void h.service.setBrightness(50);
    await wait();
    h.service.transitionBrightness(0, 10_000);
    await wait();
    release();
    await wait();
    expect(h.hardware.setBrightness).not.toHaveBeenCalled();
  });

  it('cancels the helper fade when the transition is cancelled', async () => {
    const h = await frame();
    h.service.transitionBrightness(0, 10_000, { logReason: 'AT_SUNSET' });
    await wait();
    h.service.cancelActiveTransition();
    await wait();
    expect(invoke).toHaveBeenCalledWith('steam_frame_cancel_fade', {
      pairingId: 'p',
      operation: h.sent().operation,
    });
  });
});
