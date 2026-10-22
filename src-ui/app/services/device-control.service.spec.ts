import '@angular/compiler';
import { BehaviorSubject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { DeviceControlService } from './device-control.service';
import { ToastService } from './toast.service';
import type { OVRDevice } from '../models/ovr-device';

vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock('@tauri-apps/plugin-log', () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }));

const frameController: OVRDevice = {
  index: 3,
  class: 'Controller',
  role: 'LeftHand',
  battery: 0.5,
  pose: null,
  serialNumber: 'FRAME-L',
  powerMethod: 'SteamFrame',
  isConnected: true,
  canPowerOff: true,
  isTurningOff: false,
};

function setup(disconnect: () => Promise<boolean>) {
  const openvr = { devices: new BehaviorSubject([frameController]), setTurningOff: vi.fn() };
  const steamFrame = { disconnectController: vi.fn(disconnect) };
  const service = new DeviceControlService(
    { turnOffDevices: vi.fn(async () => []) } as unknown as ConstructorParameters<
      typeof DeviceControlService
    >[0],
    steamFrame as unknown as ConstructorParameters<typeof DeviceControlService>[1],
    openvr as unknown as ConstructorParameters<typeof DeviceControlService>[2],
    new ToastService()
  );
  return { service, openvr, steamFrame };
}

describe('DeviceControlService Frame controllers', () => {
  it('routes a copy held from before the helper reported on the current device', async () => {
    const { service, steamFrame } = setup(async () => true);
    const stale: OVRDevice = { ...frameController, powerMethod: 'None', canPowerOff: false };
    expect(await service.turnOffDevices([stale])).toEqual([frameController]);
    expect(steamFrame.disconnectController).toHaveBeenCalledExactlyOnceWith('FRAME-L');
  });

  it('sends one disconnect for requests that overlap', async () => {
    const { service, steamFrame } = setup(async () => true);
    const results = await Promise.all([
      service.turnOffDevices([frameController]),
      service.turnOffDevices([frameController]),
    ]);
    expect(steamFrame.disconnectController).toHaveBeenCalledOnce();
    expect(results.flat()).toHaveLength(1);
  });

  it('marks the controller busy only once the disconnect went out', async () => {
    const failed = setup(async () => false);
    expect(await failed.service.turnOffDevices([frameController])).toEqual([]);
    expect(failed.openvr.setTurningOff).not.toHaveBeenCalled();

    const sent = setup(async () => true);
    await sent.service.turnOffDevices([frameController]);
    expect(sent.openvr.setTurningOff).toHaveBeenCalledExactlyOnceWith(3, true);
  });
});
