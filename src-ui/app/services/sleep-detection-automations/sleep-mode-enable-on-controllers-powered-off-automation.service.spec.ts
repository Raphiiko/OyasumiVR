import { BehaviorSubject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import type { AutomationConfigService } from '../automation-config.service';
import type { OpenVRService } from '../openvr.service';
import type { SleepService } from '../sleep.service';
import { AUTOMATION_CONFIGS_DEFAULT } from '../../models/automations';
import type { OVRDevice } from '../../models/ovr-device';
import { SleepModeEnableOnControllersPoweredOffAutomationService } from './sleep-mode-enable-on-controllers-powered-off-automation.service';

function controller(index: number, state: Partial<OVRDevice> = {}): OVRDevice {
  return {
    index,
    class: 'Controller',
    canPowerOff: true,
    isConnected: true,
    ...state,
  } as OVRDevice;
}

const off = { canPowerOff: false, isConnected: false };

async function setup() {
  const configs = structuredClone(AUTOMATION_CONFIGS_DEFAULT);
  configs.SLEEP_MODE_ENABLE_ON_CONTROLLERS_POWERED_OFF.enabled = true;
  const devices = new BehaviorSubject<OVRDevice[]>([]);
  const enableSleepMode = vi.fn();
  const service = new SleepModeEnableOnControllersPoweredOffAutomationService(
    { configs: new BehaviorSubject(configs) } as unknown as AutomationConfigService,
    { devices } as unknown as OpenVRService,
    { enableSleepMode } as unknown as SleepService
  );
  await service.init();
  return { devices, enableSleepMode };
}

describe('SleepModeEnableOnControllersPoweredOffAutomationService', () => {
  it('enables sleep mode when the last controller turns off', async () => {
    const h = await setup();
    h.devices.next([controller(1), controller(2)]);
    h.devices.next([controller(1, off), controller(2)]);
    expect(h.enableSleepMode).not.toHaveBeenCalled();
    h.devices.next([controller(1, off), controller(2, off)]);
    expect(h.enableSleepMode).toHaveBeenCalledTimes(1);
  });

  it('ignores controllers that can no longer be turned off but stay connected', async () => {
    const h = await setup();
    h.devices.next([controller(1), controller(2)]);
    h.devices.next([controller(1, { canPowerOff: false }), controller(2, { canPowerOff: false })]);
    expect(h.enableSleepMode).not.toHaveBeenCalled();

    // they still count once they really turn off
    h.devices.next([controller(1, off), controller(2, off)]);
    expect(h.enableSleepMode).toHaveBeenCalledTimes(1);
  });

  it('ignores controllers that vanish when SteamVR stops', async () => {
    const h = await setup();
    h.devices.next([controller(1), controller(2)]);
    h.devices.next([]);
    expect(h.enableSleepMode).not.toHaveBeenCalled();
  });

  it('forgets controllers from before a SteamVR restart', async () => {
    const h = await setup();
    h.devices.next([controller(1), controller(2)]);
    h.devices.next([]);

    // the new session lists the old indices as off controllers, one at a time
    h.devices.next([controller(1, off)]);
    h.devices.next([controller(1, off), controller(2, off)]);
    expect(h.enableSleepMode).not.toHaveBeenCalled();
  });

  it('ignores controllers that never turned on', async () => {
    const h = await setup();
    h.devices.next([controller(1, { canPowerOff: false })]);
    h.devices.next([controller(1, off)]);
    expect(h.enableSleepMode).not.toHaveBeenCalled();
  });
});
