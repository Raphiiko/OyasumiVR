import { BehaviorSubject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import type { MqttConfig } from '../../models/mqtt';
import type { AppSettingsService } from '../app-settings.service';

const clients = vi.hoisted(() => [] as ReturnType<typeof createClient>[]);
function createClient() {
  return {
    connected: true,
    on: vi.fn(),
    publishAsync: vi.fn(async (_topic: string, _payload: string, _options?: object) => {}),
    endAsync: vi.fn(async () => {}),
  };
}

vi.mock('@tauri-apps/plugin-log', () => ({ info: vi.fn(), warn: vi.fn() }));
vi.mock('mqtt', () => ({
  default: {
    connect: vi.fn(() => {
      const client = createClient();
      clients.push(client);
      return client;
    }),
  },
}));

const { MqttService } = await import('./mqtt.service');

const config: MqttConfig = {
  enabled: true,
  host: 'broker',
  port: 1883,
  username: null,
  password: null,
  secureSocket: false,
};

describe('MqttService', () => {
  it('reports offline and disconnects when MQTT is disabled', async () => {
    const service = new MqttService({ settings: new BehaviorSubject({}) } as AppSettingsService);
    await service.applyMqttConfig(config);
    const client = clients.at(-1)!;

    await service.applyMqttConfig({ ...config, enabled: false });

    expect(client.publishAsync).toHaveBeenCalledWith('OyasumiVR/available', 'offline', {
      retain: true,
    });
    expect(client.endAsync).toHaveBeenCalledOnce();
    expect(client.publishAsync.mock.invocationCallOrder[0]).toBeLessThan(
      client.endAsync.mock.invocationCallOrder[0]
    );
    expect(service.client.value).toBeNull();
  });

  it('disconnects the previous client when the config changes', async () => {
    const service = new MqttService({ settings: new BehaviorSubject({}) } as AppSettingsService);
    await service.applyMqttConfig(config);
    const previous = clients.at(-1)!;

    await service.applyMqttConfig({ ...config, host: 'other-broker' });

    expect(previous.endAsync).toHaveBeenCalledOnce();
    expect(service.client.value).toBe(clients.at(-1));
  });
});
