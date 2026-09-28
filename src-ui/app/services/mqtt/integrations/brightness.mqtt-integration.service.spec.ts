import { BehaviorSubject, Subject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import type { MqttNumberProperty } from '../../../models/mqtt';
import type { AppSettings } from '../../../models/settings';
import type { AppSettingsService } from '../../app-settings.service';
import type { AutomationConfigService } from '../../automation-config.service';
import type { HardwareBrightnessControlService } from '../../brightness-control/hardware-brightness-control.service';
import type { SimpleBrightnessControlService } from '../../brightness-control/simple-brightness-control.service';
import type { SoftwareBrightnessControlService } from '../../brightness-control/software-brightness-control.service';
import type { CCTControlService } from '../../cct-control/cct-control.service';
import type { MqttDiscoveryService } from '../mqtt-discovery.service';
import { BrightnessMqttIntegrationService } from './brightness.mqtt-integration.service';

async function createService() {
  const commands = new Map<
    string,
    Subject<{ previous: MqttNumberProperty; current: MqttNumberProperty }>
  >();
  const mqtt = {
    initProperty: vi.fn(async () => {}),
    setNumberPropertyValue: vi.fn(async () => {}),
    setNumberPropertyBounds: vi.fn(async () => {}),
    setTogglePropertyValue: vi.fn(async () => {}),
    setPropertyAvailability: vi.fn(async () => {}),
    getCommandStreamForProperty: (id: string) => {
      if (!commands.has(id)) commands.set(id, new Subject());
      return commands.get(id)!;
    },
  };
  const brightness = () => ({
    brightnessStream: new BehaviorSubject(100),
    brightnessBounds: new BehaviorSubject([0, 100]),
    driverIsAvailable: new BehaviorSubject(false),
    advancedMode: new BehaviorSubject(false),
    setBrightness: vi.fn(),
  });
  const cctStream = new BehaviorSubject(6600);
  const cctControl = {
    get cct() {
      return cctStream.value;
    },
    cctStream,
    setCCT: vi.fn(async (cct: number) => cctStream.next(Math.round(cct))),
  };
  const settings = new BehaviorSubject({ cctControlEnabled: true } as AppSettings);
  const service = new BrightnessMqttIntegrationService(
    mqtt as unknown as MqttDiscoveryService,
    brightness() as unknown as SimpleBrightnessControlService,
    brightness() as unknown as HardwareBrightnessControlService,
    brightness() as unknown as SoftwareBrightnessControlService,
    {} as AutomationConfigService,
    cctControl as unknown as CCTControlService,
    { settings } as unknown as AppSettingsService
  );
  await service.init();
  const sendCommand = (value: number) =>
    commands.get('colorTemperature')!.next({
      previous: { value: cctStream.value } as MqttNumberProperty,
      current: { value } as MqttNumberProperty,
    });
  return { mqtt, cctControl, cctStream, settings, sendCommand };
}

describe('BrightnessMqttIntegrationService color temperature', () => {
  it('publishes the color temperature property and follows its value', async () => {
    const { mqtt, cctStream } = await createService();

    expect(mqtt.initProperty).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'NUMBER', id: 'colorTemperature', min: 1000, max: 10000 })
    );
    cctStream.next(3000);
    expect(mqtt.setNumberPropertyValue).toHaveBeenCalledWith('colorTemperature', 3000);
  });

  it('follows the color temperature control setting for availability', async () => {
    const { mqtt, settings } = await createService();

    expect(mqtt.setPropertyAvailability).toHaveBeenCalledWith('colorTemperature', true);
    settings.next({ cctControlEnabled: false } as AppSettings);
    expect(mqtt.setPropertyAvailability).toHaveBeenLastCalledWith('colorTemperature', false);
  });

  it('applies commands and republishes the applied value', async () => {
    const { mqtt, cctControl, sendCommand } = await createService();

    sendCommand(2500.4);
    await vi.waitFor(() =>
      expect(mqtt.setNumberPropertyValue).toHaveBeenLastCalledWith('colorTemperature', 2500)
    );
    expect(cctControl.setCCT).toHaveBeenCalledWith(2500.4);
  });
});
