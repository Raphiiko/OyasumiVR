import { describe, expect, it, vi } from 'vitest';
import type { LighthouseConsoleService } from '../../lighthouse-console.service';
import type { OpenVRService } from '../../openvr.service';
import type { MqttDiscoveryService } from '../mqtt-discovery.service';
import type { OVRDevice } from '../../../models/ovr-device';
import { HmdTrackerControllerMqttIntegrationService } from './hmd-tracker-controller.mqtt-integration';

const controller = {
  index: 1,
  class: 'Controller',
  role: 'LeftHand',
  serialNumber: 'C1',
  canPowerOff: true,
  isConnected: true,
  isTurningOff: false,
} as OVRDevice;
const powerId = 'C-C1';

function setup() {
  const mqtt = {
    initProperty: vi.fn(async () => {}),
    getCommandStreamForProperty: vi.fn(() => ({ pipe: () => ({ subscribe: () => {} }) })),
    setPropertyAvailability: vi.fn(async () => {}),
    setTogglePropertyValue: vi.fn(async () => {}),
    setSensorPropertyValue: vi.fn(async () => {}),
  };
  const service = new HmdTrackerControllerMqttIntegrationService(
    mqtt as unknown as MqttDiscoveryService,
    {} as OpenVRService,
    {} as LighthouseConsoleService
  );
  const update = (devices: OVRDevice[], next: OVRDevice[]) =>
    service['handleDeviceChanges'](devices, next);
  return { mqtt, update };
}

describe('HmdTrackerControllerMqttIntegrationService power toggle', () => {
  it('reports a connected device as on while it cannot be turned off', async () => {
    const h = setup();
    const uncontrolled = { ...controller, canPowerOff: false };
    await h.update([], [uncontrolled]);
    expect(h.mqtt.initProperty).toHaveBeenCalledWith(
      expect.objectContaining({ id: powerId, value: true, available: false })
    );

    await h.update([uncontrolled], [uncontrolled]);
    expect(h.mqtt.setTogglePropertyValue).toHaveBeenLastCalledWith(powerId, true);
    expect(h.mqtt.setPropertyAvailability).toHaveBeenCalledWith(powerId, false);
  });

  it('reports a disconnected device as off', async () => {
    const h = setup();
    const off = { ...controller, canPowerOff: false, isConnected: false };
    await h.update([controller], [off]);
    expect(h.mqtt.setTogglePropertyValue).toHaveBeenLastCalledWith(powerId, false);
  });
});
