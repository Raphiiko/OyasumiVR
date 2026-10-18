import { BehaviorSubject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import type { AutomationConfigService } from '../automation-config.service';
import type { OpenVRService } from '../openvr.service';
import type { SleepService } from '../sleep.service';
import { AUTOMATION_CONFIGS_DEFAULT } from '../../models/automations';
import type { OVRDevice } from '../../models/ovr-device';
import { SleepModeDisableOnDevicePowerOnAutomationService } from './sleep-mode-disable-on-device-power-on-automation.service';

vi.mock('@tauri-apps/plugin-log', () => ({ info: vi.fn() }));

function controller(index: number, state: Partial<OVRDevice> = {}): OVRDevice {
  return {
    index,
    serialNumber: `C${index}`,
    class: 'Controller',
    canPowerOff: true,
    isConnected: true,
    isTurningOff: false,
    ...state,
  } as OVRDevice;
}

const off = { canPowerOff: false, isConnected: false };

async function setup(initial: OVRDevice[] = []) {
  const configs = structuredClone(AUTOMATION_CONFIGS_DEFAULT);
  Object.assign(configs.SLEEP_MODE_DISABLE_ON_DEVICE_POWER_ON, {
    enabled: true,
    triggerClasses: ['Controller'],
  });
  const devices = new BehaviorSubject<OVRDevice[]>([]);
  const powerControlled = new Set<string>();
  const emit = (list: OVRDevice[]) => {
    list.filter((d) => d.canPowerOff).forEach((d) => powerControlled.add(d.serialNumber!));
    devices.next(list);
  };
  const disableSleepMode = vi.fn();
  const service = new SleepModeDisableOnDevicePowerOnAutomationService(
    { configs: new BehaviorSubject(configs) } as unknown as AutomationConfigService,
    {
      devices,
      hasHadPowerControl: (d: OVRDevice) => powerControlled.has(d.serialNumber!),
    } as unknown as OpenVRService,
    { disableSleepMode } as unknown as SleepService
  );
  emit(initial);
  await service.init();
  return { emit, disableSleepMode };
}

describe('SleepModeDisableOnDevicePowerOnAutomationService', () => {
  it('disables sleep mode when a controller turns on', async () => {
    const h = await setup();
    h.emit([controller(1, off)]);
    h.emit([controller(1)]);
    expect(h.disableSleepMode).toHaveBeenCalledTimes(1);
  });

  it('ignores a connected controller that gains power control', async () => {
    const h = await setup();
    h.emit([controller(1, { canPowerOff: false })]);
    h.emit([controller(1)]);
    expect(h.disableSleepMode).not.toHaveBeenCalled();
  });

  it('ignores a connected controller that loses and regains power control', async () => {
    const h = await setup([controller(1)]);
    h.emit([controller(1, { canPowerOff: false })]);
    h.emit([controller(1)]);
    expect(h.disableSleepMode).not.toHaveBeenCalled();
  });

  it('ignores controllers that OyasumiVR never could turn off', async () => {
    const h = await setup();
    h.emit([controller(1, off)]);
    h.emit([controller(1, { canPowerOff: false })]);
    expect(h.disableSleepMode).not.toHaveBeenCalled();
  });
});
