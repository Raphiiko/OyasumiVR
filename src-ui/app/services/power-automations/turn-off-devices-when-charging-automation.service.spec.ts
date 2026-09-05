import { BehaviorSubject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { AUTOMATION_CONFIGS_DEFAULT } from '../../models/automations';
import type { OVRDevice } from '../../models/ovr-device';
import type { DeviceSelection } from '../../models/device-manager';
import { TurnOffDevicesWhenChargingAutomationService } from './turn-off-devices-when-charging-automation.service';

vi.mock('@tauri-apps/plugin-log', () => ({ info: vi.fn(), error: vi.fn() }));
const a = {
  index: 1,
  serialNumber: 'A',
  class: 'Controller',
  canPowerOff: true,
  isCharging: false,
} as OVRDevice;
const b = { ...a, index: 2, serialNumber: 'B' };
const selection = (serial: string): DeviceSelection => ({
  devices: [serial],
  types: [],
  tagIds: [],
});
type Dependencies = ConstructorParameters<typeof TurnOffDevicesWhenChargingAutomationService>;
async function setup() {
  const configs = new BehaviorSubject(structuredClone(AUTOMATION_CONFIGS_DEFAULT));
  const devices = new BehaviorSubject([a, b]);
  const select = (serial: string) =>
    configs.next({
      ...configs.value,
      DEVICE_POWER_AUTOMATIONS: {
        ...configs.value.DEVICE_POWER_AUTOMATIONS,
        turnOffDevicesWhenCharging: selection(serial),
      },
    });
  select('A');
  const resolve = vi.fn(async (selected: DeviceSelection) => ({
    ovrDevices: devices.value.filter((d) => selected.devices.includes(d.serialNumber!)),
    lighthouseDevices: [],
    knownDevices: [],
  }));
  const powerOff = vi.fn();
  const logEvent = vi.fn();
  const service = new TurnOffDevicesWhenChargingAutomationService(
    { configs } as unknown as Dependencies[0],
    { devices } as unknown as Dependencies[1],
    { turnOffDevices: powerOff } as unknown as Dependencies[2],
    { logEvent } as unknown as Dependencies[3],
    {
      getDevicesForSelection: resolve,
      knownDevices: new BehaviorSubject([]),
    } as unknown as Dependencies[4]
  );
  await service.init();
  return { configs, devices, select, resolve, powerOff, logEvent };
}

describe('charging device selection', () => {
  it.each([false, true])(
    'excludes A after selecting B with reordered indexes: %s',
    async (reorder) => {
      const h = await setup();
      h.select('B');
      const charging = [{ ...a, isCharging: true }, b];
      h.devices.next(reorder ? charging.reverse() : charging);
      await Promise.resolve();
      expect(h.powerOff).not.toHaveBeenCalled();
      expect(h.logEvent).not.toHaveBeenCalled();
      h.devices.next([a, { ...b, isCharging: true }]);
      await Promise.resolve();
      expect(h.powerOff).toHaveBeenCalledWith([{ ...b, isCharging: true }]);
    }
  );

  it('discards a delayed result after the selection changes', async () => {
    const h = await setup();
    let finish!: (result: Awaited<ReturnType<typeof h.resolve>>) => void;
    h.resolve.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    h.devices.next([{ ...a, isCharging: true }, b]);
    h.select('B');
    finish({ ovrDevices: [a], lighthouseDevices: [], knownDevices: [] });
    await Promise.resolve();
    expect(h.powerOff).not.toHaveBeenCalled();
  });

  it('acts once per charging transition and rearms after unplugging', async () => {
    const h = await setup();
    h.devices.next([{ ...a, isCharging: true }, b]);
    h.devices.next([{ ...a, isCharging: true }, b]);
    await Promise.resolve();
    expect(h.powerOff).toHaveBeenCalledTimes(1);
    h.devices.next([a, b]);
    h.devices.next([{ ...a, isCharging: true }, b]);
    await Promise.resolve();
    expect(h.powerOff).toHaveBeenCalledTimes(2);
    expect(h.logEvent).toHaveBeenCalledTimes(2);
  });

  it('keeps one action when power-off capability changes while charging', async () => {
    const h = await setup();
    h.devices.next([{ ...a, isCharging: true }, b]);
    await Promise.resolve();
    h.devices.next([{ ...a, isCharging: true, canPowerOff: false }, b]);
    await Promise.resolve();
    h.devices.next([{ ...a, isCharging: true }, b]);
    await Promise.resolve();
    expect(h.powerOff).toHaveBeenCalledTimes(1);
    expect(h.logEvent).toHaveBeenCalledTimes(1);
  });

  it('discards a delayed transition after unplugging and replugging', async () => {
    const h = await setup();
    let finish!: (result: Awaited<ReturnType<typeof h.resolve>>) => void;
    h.resolve.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    h.devices.next([{ ...a, isCharging: true }, b]);
    h.devices.next([a, b]);
    h.devices.next([{ ...a, isCharging: true }, b]);
    await Promise.resolve();
    finish({ ovrDevices: [a], lighthouseDevices: [], knownDevices: [] });
    await Promise.resolve();
    expect(h.powerOff).toHaveBeenCalledTimes(1);
  });

  it('does not act on a disconnected device or a failed selection lookup', async () => {
    const h = await setup();
    h.devices.next([{ ...a, isCharging: true }, b]);
    h.devices.next([b]);
    await Promise.resolve();
    expect(h.powerOff).not.toHaveBeenCalled();
    h.resolve.mockRejectedValueOnce(new Error('lookup failed'));
    h.devices.next([{ ...a, isCharging: true }, b]);
    await Promise.resolve();
    expect(h.powerOff).not.toHaveBeenCalled();
    expect(h.logEvent).not.toHaveBeenCalled();
  });
});
