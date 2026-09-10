import '@angular/compiler';
import { describe, expect, it, vi } from 'vitest';
import { BehaviorSubject, firstValueFrom } from 'rxjs';
import { AUTOMATION_CONFIGS_DEFAULT } from '../models/automations';
import { NvmlDevice } from '../models/nvml-device';
import { GpuAutomationsService } from './gpu-automations.service';

vi.mock('@tauri-apps/plugin-log', () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));

function setup(device: NvmlDevice, sleepLimit: number) {
  const configs = structuredClone(AUTOMATION_CONFIGS_DEFAULT);
  configs.GPU_POWER_LIMITS = {
    enabled: true,
    selectedDeviceId: device.uuid,
    onSleepEnable: { enabled: true, resetToDefault: false, powerLimit: sleepLimit },
    onSleepDisable: { enabled: true, resetToDefault: true },
  };
  configs.MSI_AFTERBURNER.enabled = true;
  const mode = new BehaviorSubject(false);
  const setPowerLimit = vi.fn().mockResolvedValue(true);
  const logEvent = vi.fn();
  const dependencies = [
    { configs: new BehaviorSubject(configs) },
    { devices: new BehaviorSubject([device]), setPowerLimit },
    { mode },
    { sidecarStarted: new BehaviorSubject(false) },
    { logEvent },
  ] as unknown as ConstructorParameters<typeof GpuAutomationsService>;
  const service = new GpuAutomationsService(...dependencies);
  return { service, mode, setPowerLimit, logEvent };
}

describe('GPU sleep power limits', () => {
  it.each([
    {
      vendor: 'AMD',
      device: {
        uuid: 'adlx:42',
        name: 'AMD GPU (ADLX)',
        powerLimit: 100000,
        minPowerLimit: 80000,
        maxPowerLimit: 115000,
        defaultPowerLimit: 100000,
      },
      sleepLimit: -20,
      encodedSleepLimit: 80000,
      defaultLimit: 0,
      unit: '%',
    },
    {
      vendor: 'NVIDIA',
      device: {
        uuid: 'GPU-123',
        name: 'NVIDIA GPU',
        powerLimit: 250000,
        minPowerLimit: 100000,
        maxPowerLimit: 300000,
        defaultPowerLimit: 250000,
      },
      sleepLimit: 150,
      encodedSleepLimit: 150000,
      defaultLimit: 250,
      unit: 'W',
    },
  ])('applies $vendor limits on sleep and restores defaults on wake', async (scenario) => {
    const { service, mode, setPowerLimit, logEvent } = setup(scenario.device, scenario.sleepLimit);
    await service.init();
    expect(await firstValueFrom(service.nvmlDevices)).toEqual([
      expect.objectContaining({
        type: scenario.vendor,
        powerLimitUnit: scenario.unit,
        defaultPowerLimit: scenario.defaultLimit,
        supportsPowerLimiting: true,
        selected: true,
      }),
    ]);
    expect(setPowerLimit).not.toHaveBeenCalled();

    mode.next(true);
    await vi.waitFor(() => {
      expect(setPowerLimit).toHaveBeenLastCalledWith(
        scenario.device.uuid,
        scenario.encodedSleepLimit
      );
      expect(logEvent).toHaveBeenLastCalledWith(
        expect.objectContaining({
          limit: scenario.sleepLimit,
          limitUnit: scenario.unit,
          reason: 'SLEEP_MODE_ENABLED',
        })
      );
    });

    mode.next(false);
    await vi.waitFor(() => {
      expect(setPowerLimit).toHaveBeenLastCalledWith(
        scenario.device.uuid,
        scenario.device.defaultPowerLimit
      );
      expect(logEvent).toHaveBeenLastCalledWith(
        expect.objectContaining({
          limit: scenario.defaultLimit,
          limitUnit: scenario.unit,
          resetToDefault: true,
          reason: 'SLEEP_MODE_DISABLED',
        })
      );
    });
    expect(setPowerLimit).toHaveBeenCalledTimes(2);
    mode.complete();
  });
});
