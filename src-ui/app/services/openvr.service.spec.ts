import { ApplicationRef } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { expect, it, vi } from 'vitest';
import { OVRDevice } from '../models/ovr-device';
import { AppSettingsService } from './app-settings.service';
import { OpenVRService } from './openvr.service';
import { TelemetryService } from './telemetry.service';

it('keeps devices in tracked-index order across arrivals and repeated updates', async () => {
  const service = new OpenVRService(
    { tick: vi.fn() } as unknown as ApplicationRef,
    {} as AppSettingsService,
    {} as TelemetryService
  );
  const device = (index: number): OVRDevice => ({
    index,
    class: 'GenericTracker',
    role: 'Invalid',
    battery: 50,
    pose: null,
    canPowerOff: true,
    isTurningOff: false,
  });

  for (const index of [12, 0, 3]) service.onDeviceUpdate(device(index));
  expect((await firstValueFrom(service.devices)).map((d) => d.index)).toEqual([0, 3, 12]);

  for (const index of [12, 3, 12]) {
    service.onDeviceUpdate({ ...device(index), battery: 40, isTurningOff: true });
    const devices = await firstValueFrom(service.devices);
    expect(devices.map((d) => d.index)).toEqual([0, 3, 12]);
    expect(devices.find((d) => d.index === index)).toMatchObject({
      battery: 40,
      isTurningOff: true,
    });
  }
});
