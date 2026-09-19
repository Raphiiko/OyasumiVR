import { CancellableTask } from '../../utils/cancellable-task';
import { smoothLerp } from '../../utils/number-utils';
import { BehaviorSubject, firstValueFrom, Subject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { AUTOMATION_CONFIGS_DEFAULT } from '../../models/automations';
import { SimpleBrightnessControlService } from './simple-brightness-control.service';

vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock('@tauri-apps/plugin-log', () => ({ info: vi.fn(), warn: vi.fn() }));
type Dependencies = ConstructorParameters<typeof SimpleBrightnessControlService>;

async function setup(advancedMode = false) {
  const configs = new BehaviorSubject({
    ...structuredClone(AUTOMATION_CONFIGS_DEFAULT),
    BRIGHTNESS_AUTOMATIONS: { ...AUTOMATION_CONFIGS_DEFAULT.BRIGHTNESS_AUTOMATIONS, advancedMode },
  });
  const hardware = {
    hasFrameCompanion: false,
    brightnessStream: new BehaviorSubject(100),
    driverIsAvailable: new BehaviorSubject(false),
    brightnessBounds: new BehaviorSubject([20, 100]),
    setBrightness: vi.fn<Dependencies[1]['setBrightness']>().mockResolvedValue(undefined),
    cancelActiveTransition: vi.fn(),
  };
  const software = {
    brightness: 100,
    brightnessStream: new BehaviorSubject(100),
    setBrightness: vi.fn<Dependencies[2]['setBrightness']>().mockResolvedValue(undefined),
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

describe('delegated simple transitions', () => {
  it.each([
    [80, 0],
    [0, 80],
  ])('shares one duration and floor curve from %s to %s', async (from, to) => {
    const h = await setup();
    const progressValues = [0, 0.25, 0.5, 0.75, 1];
    const hardware = Object.assign(h.hardware, {
      hasFrameCompanion: true,
      delegatesTransitions: true,
      delegateTransition: vi.fn(
        (
          _target: number,
          duration: number,
          curve: { from: number; to: number },
          progress: (value: number) => Promise<void>
        ) => {
          expect(duration).toBe(2400);
          expect(curve).toEqual({ from, to });
          const task = new CancellableTask(async () => {
            for (const value of progressValues) await progress(value);
          });
          void task.start();
          return task;
        }
      ),
    });
    hardware.brightnessBounds.next([9, 125]);
    hardware.driverIsAvailable.next(true);
    await h.service.setBrightness(from);
    hardware.setBrightness.mockClear();
    h.software.setBrightness.mockClear();
    const task = h.service.transitionBrightness(to, 2400);
    await firstValueFrom(task.onComplete);
    expect(hardware.delegateTransition).toHaveBeenCalledTimes(1);
    expect(hardware.setBrightness).not.toHaveBeenCalled();
    expect(h.software.setBrightness.mock.calls.map((call) => call[0])).toEqual(
      progressValues.map((progress) => {
        const value = smoothLerp(from, to, progress);
        return value < 9 ? (value / 9) * 100 : 100;
      })
    );
    expect(h.service.brightness).toBe(to);
  });
  it('preserves confirmed simple brightness after a hardware write failure', async () => {
    const h = await setup();
    h.hardware.driverIsAvailable.next(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await h.service.setBrightness(60);
    h.hardware.setBrightness.mockRejectedValueOnce('write_failed');
    await expect(h.service.setBrightness(40)).rejects.toBe('write_failed');
    expect(h.service.brightness).toBe(60);
  });
});

describe('simple brightness request ordering', () => {
  it('discards an older request waiting for software brightness', async () => {
    const h = await setup();
    h.hardware.driverIsAvailable.next(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    let finish!: () => void;
    h.software.setBrightness.mockImplementationOnce(
      () => new Promise<void>((resolve) => (finish = resolve))
    );
    const old = h.service.setBrightness(30);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await h.service.setBrightness(70);
    h.hardware.setBrightness.mockClear();
    finish();
    await old;
    expect(h.hardware.setBrightness).not.toHaveBeenCalled();
    expect(h.service.brightness).toBe(70);
    h.service.ngOnDestroy();
  });
});

it('reconciles simple brightness when Frame bounds arrive after its value', async () => {
  const h = await setup();
  h.hardware.hasFrameCompanion = true;
  h.hardware.brightnessStream.next(100);
  h.hardware.brightnessBounds.next([9, 125]);
  expect(h.service.brightness).toBeCloseTo(9 + (91 / 116) * 91);
  expect(h.hardware.setBrightness).not.toHaveBeenCalled();
  h.service.ngOnDestroy();
  h.hardware.brightnessStream.next(50);
  expect(h.service.brightness).toBeCloseTo(9 + (91 / 116) * 91);
});

it('reconciles software dimming at the Frame hardware floor', async () => {
  const h = await setup();
  h.hardware.hasFrameCompanion = true;
  h.hardware.brightnessBounds.next([9, 125]);
  h.hardware.brightnessStream.next(9);
  h.software.brightnessStream.next(50);
  expect(h.service.brightness).toBe(4.5);
  h.service.ngOnDestroy();
});
