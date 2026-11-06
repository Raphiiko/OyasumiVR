import { BehaviorSubject, Subject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import type { LighthouseDevice } from '../../../models/lighthouse-device';
import type { MqttToggleProperty } from '../../../models/mqtt';
import type { AppSettingsService } from '../../app-settings.service';
import type { LighthouseService } from '../../lighthouse.service';
import type { MqttDiscoveryService } from '../mqtt-discovery.service';
import { BaseStationMqttIntegrationService } from './base-station.mqtt-integration.service';

function station(id: string, deviceType: LighthouseDevice['deviceType']): LighthouseDevice {
  return { id, deviceName: id, deviceType, powerState: 'on', v1Timeout: null };
}

const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

async function createService(devices: LighthouseDevice[], identifiers = {}) {
  const commands = new Map<string, Subject<{ current: MqttToggleProperty }>>();
  const mqtt = {
    initProperty: vi.fn(async () => {}),
    setPropertyAvailability: vi.fn(async () => {}),
    setTogglePropertyValue: vi.fn(async () => {}),
    setSensorPropertyValue: vi.fn(async () => {}),
    getCommandStreamForProperty: (id: string) => {
      if (!commands.has(id)) commands.set(id, new Subject());
      return commands.get(id)!;
    },
  };
  const enabledDevices = new BehaviorSubject(devices);
  const lighthouse = { enabledDevices, setPowerState: vi.fn(async () => true) };
  const settings = new BehaviorSubject({
    v1LighthouseIdentifiers: identifiers as Record<string, string>,
    lighthousePowerOffState: 'sleep',
  });
  const service = new BaseStationMqttIntegrationService(
    mqtt as unknown as MqttDiscoveryService,
    lighthouse as unknown as LighthouseService,
    { settings } as unknown as AppSettingsService
  );
  await service.init();
  await flush();
  const publishedIds = () =>
    mqtt.initProperty.mock.calls
      .map(([p]) => (p as { id: string }).id)
      .filter((id) => !id.endsWith('power_state'));
  return { mqtt, lighthouse, enabledDevices, settings, commands, publishedIds };
}

describe('BaseStationMqttIntegrationService', () => {
  it('publishes V2 stations and V1 stations with an identifier, but not V1 stations without one', async () => {
    const { publishedIds } = await createService(
      [
        station('V2', 'lighthouseV2'),
        station('V1A', 'lighthouseV1'),
        station('V1B', 'lighthouseV1'),
      ],
      { V1A: 'ABCD1234' }
    );

    expect(publishedIds()).toEqual(['LH-V2', 'LH-V1A']);
  });

  it('publishes a V1 station once its identifier is set', async () => {
    const { settings, publishedIds } = await createService([station('V1', 'lighthouseV1')]);
    expect(publishedIds()).toEqual([]);

    settings.next({ ...settings.value, v1LighthouseIdentifiers: { V1: 'ABCD1234' } });
    await flush();

    expect(publishedIds()).toEqual(['LH-V1']);
  });

  it('sends one power command per MQTT command after a station is removed and added again', async () => {
    const v2 = station('V2', 'lighthouseV2');
    const { enabledDevices, lighthouse, commands } = await createService([v2]);

    enabledDevices.next([]);
    await flush();
    enabledDevices.next([v2]);
    await flush();
    commands.get('LH-V2')!.next({ current: { value: true } as MqttToggleProperty });
    await flush();

    expect(lighthouse.setPowerState).toHaveBeenCalledTimes(1);
  });
});
