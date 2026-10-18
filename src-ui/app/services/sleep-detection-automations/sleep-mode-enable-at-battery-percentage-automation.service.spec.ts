import { BehaviorSubject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import type { AutomationConfigService } from '../automation-config.service';
import type { OpenVRService } from '../openvr.service';
import type { SleepService } from '../sleep.service';
import { AUTOMATION_CONFIGS_DEFAULT } from '../../models/automations';
import type { OVRDevice } from '../../models/ovr-device';
import { SleepModeEnableAtBatteryPercentageAutomationService } from './sleep-mode-enable-at-battery-percentage-automation.service';

function controller(index: number, battery: number, state: Partial<OVRDevice> = {}): OVRDevice {
  return {
    index,
    class: 'Controller',
    battery,
    canPowerOff: true,
    isConnected: true,
    ...state,
  } as OVRDevice;
}

async function setup() {
  const configs = structuredClone(AUTOMATION_CONFIGS_DEFAULT);
  Object.assign(configs.SLEEP_MODE_ENABLE_AT_BATTERY_PERCENTAGE, {
    enabled: true,
    triggerClasses: ['Controller'],
    threshold: 20,
  });
  const devices = new BehaviorSubject<OVRDevice[]>([]);
  const enableSleepMode = vi.fn();
  const service = new SleepModeEnableAtBatteryPercentageAutomationService(
    { configs: new BehaviorSubject(configs) } as unknown as AutomationConfigService,
    { devices } as unknown as OpenVRService,
    { enableSleepMode } as unknown as SleepService
  );
  await service.init();
  return { devices, enableSleepMode };
}

describe('SleepModeEnableAtBatteryPercentageAutomationService', () => {
  it('does not trigger again while another connected device is below the threshold', async () => {
    const h = await setup();
    h.devices.next([controller(2, 0.5), controller(1, 0.1, { canPowerOff: false })]);
    h.devices.next([controller(2, 0.15), controller(1, 0.1, { canPowerOff: false })]);
    expect(h.enableSleepMode).not.toHaveBeenCalled();
  });

  it('ignores a disconnected device below the threshold', async () => {
    const h = await setup();
    h.devices.next([controller(2, 0.5), controller(1, 0.1, { isConnected: false })]);
    h.devices.next([controller(2, 0.15), controller(1, 0.1, { isConnected: false })]);
    expect(h.enableSleepMode).toHaveBeenCalledTimes(1);
  });
});
