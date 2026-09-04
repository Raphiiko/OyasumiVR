import { BehaviorSubject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSettingsService } from './app-settings.service';
import type { LighthouseDevice } from '../models/lighthouse-device';
import {
  DevicePowerButtonComponent,
  type DevicePowerState,
} from '../components/device-power-button/device-power-button.component';

const invoke = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invoke(...args) }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));

import { LighthouseService } from './lighthouse.service';

function device(): LighthouseDevice {
  return {
    id: 'dev-1',
    deviceName: 'LHB-1',
    deviceType: 'lighthouseV2',
    powerState: 'on',
    v1Timeout: null,
    transitioningToPowerState: undefined,
  };
}

// mirrors the mapping in DeviceListItemComponent
function powerButtonFor(d: LighthouseDevice): DevicePowerButtonComponent {
  const state: DevicePowerState = d.transitioningToPowerState
    ? d.transitioningToPowerState === 'on'
      ? 'turning-on'
      : 'turning-off'
    : d.powerState === 'on'
      ? 'on'
      : 'off';
  const button = new DevicePowerButtonComponent();
  button.powerState = state;
  return button;
}

function makeService(d: LighthouseDevice) {
  const appSettings = {
    settings: new BehaviorSubject({ v1LighthouseIdentifiers: {} }),
  } as unknown as AppSettingsService;
  const service = new LighthouseService(appSettings);
  service['_devices'].next([d]);
  return service;
}

describe('LighthouseService.setPowerState', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    invoke.mockReset();
  });

  afterEach(() => vi.useRealTimers());

  it('clears the transition marker after every attempt fails, and still rejects', async () => {
    invoke.mockRejectedValue(new Error('WRITE_FAILED'));
    const d = device();
    const service = makeService(d);
    const emissions: (string | undefined)[] = [];
    service.devices.subscribe((devices) => emissions.push(devices[0].transitioningToPowerState));

    const settled = service.setPowerState(d, 'sleep').then(
      () => 'resolved',
      (e: Error) => e.message
    );
    await vi.advanceTimersByTimeAsync(500);
    expect(powerButtonFor(d).canClick).toBe(false);
    await vi.advanceTimersByTimeAsync(4500);

    expect(await settled).toBe('WRITE_FAILED');
    expect(invoke).toHaveBeenCalledTimes(4);
    expect(d.transitioningToPowerState).toBeUndefined();
    expect(emissions).toEqual([undefined, 'sleep', undefined]);
    expect(powerButtonFor(d).canClick).toBe(true);
  });

  it('clears the transition marker once the device confirms the new state', async () => {
    invoke.mockResolvedValue(undefined);
    const d = device();
    const service = makeService(d);

    const settled = service.setPowerState(d, 'sleep');
    d.powerState = 'sleep';
    await vi.advanceTimersByTimeAsync(1000);
    await settled;

    expect(d.transitioningToPowerState).toBeUndefined();
  });

  it('clears the transition marker after the ten second confirmation timeout', async () => {
    invoke.mockResolvedValue(undefined);
    const d = device();
    const service = makeService(d);

    const settled = service.setPowerState(d, 'sleep');
    await vi.advanceTimersByTimeAsync(10000);
    await settled;

    expect(d.transitioningToPowerState).toBeUndefined();
  });

  it('does not let an older failed operation clear a newer transition', async () => {
    invoke.mockImplementation(async (_command: string, args: { powerState: string }) => {
      if (args.powerState === 'sleep') throw new Error('WRITE_FAILED');
    });
    const d = device();
    // start asleep, so the newer 'on' command cannot confirm before the older one settles
    d.powerState = 'sleep';
    const service = makeService(d);

    const older = service.setPowerState(d, 'sleep').catch(() => 'failed');
    const newer = service.setPowerState(d, 'on');
    await vi.advanceTimersByTimeAsync(3000);

    expect(await older).toBe('failed');
    expect(d.transitioningToPowerState).toBe('on');

    d.powerState = 'on';
    await vi.advanceTimersByTimeAsync(11000);
    await newer;
    expect(d.transitioningToPowerState).toBeUndefined();
  });

  it('does not let a forced operation clear a concurrent transition', async () => {
    invoke.mockResolvedValue(undefined);
    const d = device();
    const service = makeService(d);

    const normal = service.setPowerState(d, 'sleep');
    const forced = service.setPowerState(d, 'on', true);
    d.powerState = 'on';
    await vi.advanceTimersByTimeAsync(1000);
    await forced;

    expect(d.transitioningToPowerState).toBe('sleep');

    await vi.advanceTimersByTimeAsync(10000);
    await normal;
    expect(d.transitioningToPowerState).toBeUndefined();
  });
});
