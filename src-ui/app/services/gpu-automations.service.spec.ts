import '@angular/compiler';
import { BehaviorSubject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { GpuAutomationsService } from './gpu-automations.service';
import { AUTOMATION_CONFIGS_DEFAULT } from '../models/automations';
import type { GPUDevice } from '../models/gpu-device';

const log = vi.hoisted(() => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/plugin-log', () => log);

const device: GPUDevice = {
  name: 'GPU',
  id: 'GPU-UUID',
  type: 'NVIDIA',
  supportsPowerLimiting: true,
  minPowerLimit: 100,
  maxPowerLimit: 300,
  defaultPowerLimit: 250,
};

function createService(setPowerLimit: (uuid: string, powerLimit: number) => Promise<void>) {
  const configs = new BehaviorSubject({
    ...AUTOMATION_CONFIGS_DEFAULT,
    GPU_POWER_LIMITS: {
      enabled: true,
      selectedDeviceId: device.id,
      onSleepEnable: { enabled: true, resetToDefault: false, powerLimit: 150 },
      onSleepDisable: { enabled: true, resetToDefault: true },
    },
    MSI_AFTERBURNER: { ...AUTOMATION_CONFIGS_DEFAULT.MSI_AFTERBURNER, enabled: true },
  });
  const mode = new BehaviorSubject(false);
  const nvml = { setPowerLimit: vi.fn(setPowerLimit) };
  const eventLog = { logEvent: vi.fn() };
  const service = new GpuAutomationsService(
    { configs } as unknown as ConstructorParameters<typeof GpuAutomationsService>[0],
    nvml as unknown as ConstructorParameters<typeof GpuAutomationsService>[1],
    { mode } as unknown as ConstructorParameters<typeof GpuAutomationsService>[2],
    {} as ConstructorParameters<typeof GpuAutomationsService>[3],
    eventLog as unknown as ConstructorParameters<typeof GpuAutomationsService>[4]
  );
  const internals = service as unknown as {
    _nvmlDevices: BehaviorSubject<GPUDevice[]>;
    setupPowerLimitOnSleepAutomations(): void;
  };
  internals._nvmlDevices.next([device]);
  internals.setupPowerLimitOnSleepAutomations();
  return { mode, nvml, eventLog };
}

describe('GpuAutomationsService sleep power limits', () => {
  it('keeps setting the limit after NVML refuses one', async () => {
    const { mode, nvml, eventLog } = createService(async () => {
      throw 'DeviceSetPowerLimitError';
    });

    mode.next(true);
    await vi.waitFor(() => expect(log.error).toHaveBeenCalledOnce());
    mode.next(false);
    await vi.waitFor(() => expect(log.error).toHaveBeenCalledTimes(2));
    mode.next(true);
    await vi.waitFor(() => expect(log.error).toHaveBeenCalledTimes(3));

    expect(nvml.setPowerLimit.mock.calls).toEqual([
      [device.id, 150_000],
      [device.id, 250_000],
      [device.id, 150_000],
    ]);
    expect(log.error.mock.calls[0][0]).toContain('DeviceSetPowerLimitError');
    expect(eventLog.logEvent).not.toHaveBeenCalled();
  });

  it('logs the change when the limit is set', async () => {
    const { mode, eventLog } = createService(async () => {});

    mode.next(true);
    await vi.waitFor(() => expect(eventLog.logEvent).toHaveBeenCalledOnce());

    expect(eventLog.logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'gpuPowerLimitChanged',
        limit: 150,
        reason: 'SLEEP_MODE_ENABLED',
      })
    );
  });
});
