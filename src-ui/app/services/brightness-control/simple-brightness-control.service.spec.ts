import { BehaviorSubject, firstValueFrom, Subject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { AUTOMATION_CONFIGS_DEFAULT } from '../../models/automations';
import { SimpleBrightnessControlService } from './simple-brightness-control.service';

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
    adoptedBrightness: new Subject<{ percentage: number; bounds: [number, number] }>(),
    lastActiveDriver: (pushesBrightnessChanges ? { pushesBrightnessChanges: true } : null) as {
      pushesBrightnessChanges: boolean;
    } | null,
    activeDriver: (pushesBrightnessChanges ? { pushesBrightnessChanges: true } : null) as {
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
  return { configs, hardware, software, service, cancel, mode };
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
    h.hardware.driverIsAvailable.next(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(h.software.setBrightness).toHaveBeenLastCalledWith(100, expect.anything());
    expect(h.hardware.setBrightness).toHaveBeenLastCalledWith(40, expect.anything());
    h.mode(true);
    h.hardware.setBrightness.mockClear();
    h.software.setBrightness.mockClear();
    h.hardware.driverIsAvailable.next(false);
    await Promise.resolve();
    expect(h.software.setBrightness).not.toHaveBeenCalled();
    expect(h.hardware.setBrightness).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    'discards a pending restore after mode changes, including return to simple: %s',
    async (returnToSimple) => {
      const h = await setup();
      h.hardware.driverIsAvailable.next(true);
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
    h.hardware.driverIsAvailable.next(true);
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
    await h.service.setBrightness(40);
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

  it('fades a transition through the PC loop', async () => {
    const h = await reporting();
    const task = h.service.transitionBrightness(50, 200);
    await firstValueFrom(task.onComplete);
    expect(h.hardware.setBrightness.mock.calls.length).toBeGreaterThan(2);
    expect(h.service.brightness).toBe(50);
  });

  it('writes a transition target that equals the derived value', async () => {
    const h = await reporting();
    await h.service.setBrightness(50);
    h.hardware.setBrightness.mockClear();
    const task = h.service.transitionBrightness(50, 10000);
    await settle();
    expect(task.isComplete()).toBe(true);
    expect(h.hardware.setBrightness).toHaveBeenCalledOnce();
  });

  it('gives the simple value to a device that takes over from a pushing one', async () => {
    const h = await reporting();
    h.hardware.onDriverChange.next();
    await h.service.setBrightness(60);
    h.software.setBrightness.mockClear();
    h.hardware.setBrightness.mockClear();
    // a Beyond that stayed available takes over; availability never turns false
    h.hardware.activeDriver = { pushesBrightnessChanges: false };
    h.hardware.lastActiveDriver = h.hardware.activeDriver;
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
