import '@angular/compiler';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DeviceListComponent } from './device-list.component';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock('@tauri-apps/plugin-log', () => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

function createDeviceList() {
  const stub = {} as never;
  return new DeviceListComponent(stub, stub, stub, stub, stub, stub, stub, stub, stub);
}

const pulsoidCategories = (deviceList: DeviceListComponent) =>
  deviceList.deviceCategories.filter((category) => category.type === 'Pulsoid');

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(100_000);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('DeviceListComponent.processPulsoidDevice', () => {
  it('shows the heart rate monitor while heart rate arrives', () => {
    const deviceList = createDeviceList();

    deviceList.processPulsoidDevice(72, Date.now() - 1000, { percent: 67, measuredAt: 0 });

    expect(pulsoidCategories(deviceList)).toEqual([
      expect.objectContaining({ device: { heartRate: 72, batteryPercentage: 67 } }),
    ]);
  });

  it('hides a heart rate the service replays after it stopped', () => {
    const deviceList = createDeviceList();

    deviceList.processPulsoidDevice(72, Date.now() - 60_000, null);

    expect(pulsoidCategories(deviceList)).toEqual([]);
  });

  it('removes the heart rate monitor once heart rate stops', () => {
    const deviceList = createDeviceList();
    deviceList.processPulsoidDevice(72, Date.now(), null);

    deviceList.processPulsoidDevice(null, Date.now() - 10_001, null);

    expect(pulsoidCategories(deviceList)).toEqual([]);
  });
});
