import { BehaviorSubject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import type { MqttProperty, MqttStatus } from '../../models/mqtt';
import type { SleepService } from '../sleep.service';
import type { MqttService } from './mqtt.service';
import { MqttDiscoveryService } from './mqtt-discovery.service';

vi.mock('../../utils/app-utils', () => ({ getVersion: async () => 'test' }));

async function createService() {
  let receive!: (topic: string, payload: Buffer) => Promise<void>;
  const client = {
    connected: true,
    publishAsync: vi.fn(async (_topic: string, _payload: string, _options?: object) => {}),
    subscribeAsync: vi.fn(async (_topics: string[]) => {}),
    on: vi.fn((_event: string, handler: typeof receive) => (receive = handler)),
  };
  const clientStatus = new BehaviorSubject<MqttStatus>('CONNECTED');
  const service = new MqttDiscoveryService(
    { client: new BehaviorSubject(client), clientStatus } as unknown as MqttService,
    {} as SleepService
  );
  await service.init();
  await vi.waitFor(() => expect(client.subscribeAsync).toHaveBeenCalled());
  return {
    service,
    client,
    clientStatus,
    receive: (topic: string, payload: string) => receive(topic, Buffer.from(payload)),
  };
}

const properties: MqttProperty[] = [
  { type: 'TOGGLE', id: 'sleep', topicPath: 'sleep', displayName: 'Sleep', value: true },
  {
    type: 'NUMBER',
    id: 'brightness',
    topicPath: 'brightness',
    displayName: 'Brightness',
    value: 45,
    available: true,
  },
  {
    type: 'SENSOR',
    id: 'battery',
    topicPath: 'device/battery',
    displayName: 'Battery',
    value: '80',
    available: false,
  },
  {
    type: 'LIGHT',
    id: 'led',
    topicPath: 'device/led',
    displayName: 'LED',
    state: true,
    rgbMode: true,
    rgbValue: [1, 2, 3],
  },
  { type: 'BUTTON', id: 'button', topicPath: 'button', displayName: 'Button' },
];

describe('Home Assistant MQTT recovery', () => {
  it('restores unchanged states and availability after Home Assistant starts', async () => {
    const { service, client, receive } = await createService();
    for (const property of properties) await service.initProperty(structuredClone(property));
    expect(client.subscribeAsync).toHaveBeenCalledWith(
      expect.arrayContaining(['homeassistant/status'])
    );
    client.publishAsync.mockClear();

    await receive('homeassistant/status', 'online');

    expect(client.publishAsync.mock.calls).toEqual([
      ['OyasumiVR/sleep/state', 'ON'],
      ['OyasumiVR/brightness/state', '45'],
      ['OyasumiVR/device/battery/state', '80'],
      ['OyasumiVR/device/led/rgbState', '1,2,3'],
      ['OyasumiVR/device/led/state', 'ON'],
      ['OyasumiVR/brightness/available', 'online'],
      ['OyasumiVR/device/battery/available', 'offline'],
    ]);
  });

  it('replays current values and omits disposed devices', async () => {
    const { service, client, receive } = await createService();
    for (const property of properties) await service.initProperty(structuredClone(property));
    await service.setTogglePropertyValue('sleep', false);
    await service.setNumberPropertyValue('brightness', 60);
    await service.setPropertyAvailability('brightness', false);
    await service.disposeProperty('battery');
    client.publishAsync.mockClear();

    await receive('homeassistant/status', 'online');

    expect(client.publishAsync).toHaveBeenCalledWith('OyasumiVR/sleep/state', 'OFF');
    expect(client.publishAsync).toHaveBeenCalledWith('OyasumiVR/brightness/state', '60');
    expect(client.publishAsync).toHaveBeenCalledWith('OyasumiVR/brightness/available', 'offline');
    expect(client.publishAsync.mock.calls.some(([topic]) => topic.includes('battery'))).toBe(false);
  });

  it('ignores offline and unrelated announcements and still handles commands', async () => {
    const { service, client, receive } = await createService();
    await service.initProperty(structuredClone(properties[0]));
    const command = vi.fn();
    service.getCommandStreamForProperty('sleep').subscribe(command);
    client.publishAsync.mockClear();

    await receive('homeassistant/status', 'offline');
    await receive('homeassistant/status', 'unexpected');
    await receive('another/status', 'online');
    expect(client.publishAsync).not.toHaveBeenCalled();
    expect(command).not.toHaveBeenCalled();

    await receive('OyasumiVR/sleep/set', 'OFF');
    expect(client.publishAsync).toHaveBeenCalledWith('OyasumiVR/sleep/state', 'OFF');
    expect(command).toHaveBeenCalledOnce();
  });

  it('waits for state and availability publishes before finishing recovery', async () => {
    const { service, client, receive } = await createService();
    await service.initProperty({ ...structuredClone(properties[3]), available: true });
    const rgb = Promise.withResolvers<void>();
    const availability = Promise.withResolvers<void>();
    client.publishAsync.mockImplementation(async (topic) => {
      if (topic.endsWith('/rgbState')) await rgb.promise;
      if (topic.endsWith('/available')) await availability.promise;
    });
    client.publishAsync.mockClear();
    let finished = false;
    const recovery = receive('homeassistant/status', 'online').then(() => (finished = true));
    await vi.waitFor(() =>
      expect(client.publishAsync).toHaveBeenCalledWith('OyasumiVR/device/led/rgbState', '1,2,3')
    );
    expect(client.publishAsync).not.toHaveBeenCalledWith(
      'OyasumiVR/device/led/available',
      'online'
    );
    expect(finished).toBe(false);
    rgb.resolve();
    await vi.waitFor(() =>
      expect(client.publishAsync).toHaveBeenCalledWith('OyasumiVR/device/led/available', 'online')
    );
    expect(finished).toBe(false);
    availability.resolve();
    await recovery;
    expect(finished).toBe(true);
  });
});
