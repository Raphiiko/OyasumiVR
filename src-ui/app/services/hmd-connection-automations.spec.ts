import { BehaviorSubject, Subject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FrameLimitAutomationsService } from './frame-limit-automations.service';
import { RenderResolutionAutomationService } from './render-resolution-automation.service';
import { ChaperoneFadeDistanceAutomationService } from './fade-distance-automation.service';
import { BrightnessCctAutomationService } from './brightness-cct-automation.service';
import { AUTOMATION_CONFIGS_DEFAULT } from '../models/automations';
import type { OVRDevice } from '../models/ovr-device';

vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/plugin-log', () => ({ info: vi.fn(), error: vi.fn() }));

const hmd: OVRDevice = {
  index: 0,
  class: 'HMD',
  role: 'Invalid',
  serialNumber: 'cached-hmd',
  battery: 100,
  pose: null,
  isTurningOff: false,
};

function createServices(devices: BehaviorSubject<OVRDevice[]>) {
  const values = structuredClone(AUTOMATION_CONFIGS_DEFAULT);
  values.BRIGHTNESS_AUTOMATIONS.AT_SUNRISE.activationTime = '06:00';
  values.BRIGHTNESS_AUTOMATIONS.AT_SUNSET.activationTime = '18:00';
  const configs = { configs: new BehaviorSubject(values) } as never;
  const sleep = { mode: new BehaviorSubject(false) } as never;
  const openvr = { devices } as never;
  const preparation = { onSleepPreparation: new Subject() } as never;
  const unused = {} as never;
  const brightness = new BrightnessCctAutomationService(
    configs,
    sleep,
    unused,
    unused,
    unused,
    unused,
    unused,
    preparation,
    openvr
  );
  vi.spyOn(
    brightness as unknown as { updateSunriseSunsetTimes(): Promise<void> },
    'updateSunriseSunsetTimes'
  ).mockResolvedValue();
  return {
    frameLimit: new FrameLimitAutomationsService(
      configs,
      sleep,
      openvr,
      preparation,
      unused,
      unused
    ),
    resolution: new RenderResolutionAutomationService(configs, sleep, openvr, unused),
    fadeDistance: new ChaperoneFadeDistanceAutomationService(configs, sleep, openvr, unused),
    brightness,
  };
}

describe.each(['frameLimit', 'resolution', 'fadeDistance', 'brightness'] as const)(
  '%s HMD connection automation',
  (name) => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => {
      vi.clearAllTimers();
      vi.useRealTimers();
      vi.restoreAllMocks();
    });

    it.each(['cached-hmd', undefined])(
      'applies the cached HMD with serial %s once and ignores property-only updates',
      async (serialNumber) => {
        const cachedHmd = { ...hmd, serialNumber };
        const devices = new BehaviorSubject([cachedHmd]);
        const service = createServices(devices)[name];
        const connected = vi
          .spyOn(service as unknown as { onHmdConnect(): Promise<void> }, 'onHmdConnect')
          .mockResolvedValue();
        await service.init();
        await vi.advanceTimersByTimeAsync(3000);
        expect(connected).toHaveBeenCalledTimes(1);
        devices.next([{ ...cachedHmd, battery: 99 }]);
        await vi.advanceTimersByTimeAsync(3000);
        expect(connected).toHaveBeenCalledTimes(1);
        devices.next([]);
        devices.next([cachedHmd]);
        await vi.advanceTimersByTimeAsync(3000);
        expect(connected).toHaveBeenCalledTimes(2);
      }
    );

    it.each(['cached-hmd', undefined])(
      'waits for a headset with serial %s when the initial cache is empty',
      async (serialNumber) => {
        const cachedHmd = { ...hmd, serialNumber };
        const devices = new BehaviorSubject<OVRDevice[]>([]);
        const service = createServices(devices)[name];
        const connected = vi
          .spyOn(service as unknown as { onHmdConnect(): Promise<void> }, 'onHmdConnect')
          .mockResolvedValue();
        await service.init();
        await vi.advanceTimersByTimeAsync(3000);
        expect(connected).not.toHaveBeenCalled();
        devices.next([cachedHmd]);
        await vi.advanceTimersByTimeAsync(3000);
        expect(connected).toHaveBeenCalledTimes(1);
      }
    );
  }
);
