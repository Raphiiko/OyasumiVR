import { BehaviorSubject, firstValueFrom } from 'rxjs';
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
    driverIsAvailable: new BehaviorSubject(false),
    brightnessBounds: new BehaviorSubject([20, 100]),
    setBrightness: vi.fn(async () => {}),
    cancelActiveTransition: vi.fn(),
  };
  const software = {
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
});
