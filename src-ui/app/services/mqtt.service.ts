import { Injectable } from '@angular/core';
import mqtt from 'mqtt';
import { BehaviorSubject, concatMap, debounceTime, distinctUntilChanged, map, skip } from 'rxjs';
import { AppSettingsService } from './app-settings.service';
import { AppSettings } from '../models/settings';
import { isEqual } from 'lodash';
import { info, warn } from 'tauri-plugin-log-api';
import { MqttConfig, MqttStatus } from '../models/mqtt';

@Injectable({
  providedIn: 'root',
})
export class MqttService {
  client = new BehaviorSubject<mqtt.MqttClient | null>(null);
  clientStatus = new BehaviorSubject<MqttStatus>('DISABLED');

  constructor(private appSettings: AppSettingsService) {
    this.clientStatus.pipe(skip(1)).subscribe((status) => {
      info('[MQTT] MQTT Client is now ' + status);
    });
  }

  async init() {
    this.appSettings.settings
      .pipe(
        debounceTime(1000),
        map(MqttService.mapAppSettingsToMqttConfig),
        distinctUntilChanged((a, b) => isEqual(a, b)),
        concatMap((config) => this.applyMqttConfig(config))
      )
      .subscribe();
  }

  async applyMqttConfig(config: MqttConfig) {
    if (config.enabled) {
      await this.createClient(config);
    } else {
      await this.destroyClient();
      this.setClientStatus('DISABLED');
    }
  }

  public async testMqttConfig(config: MqttConfig): Promise<boolean> {
    const url = this.getBrokerUrl(config);
    try {
      const client = await mqtt.connectAsync(url, {
        username: config.username ?? undefined,
        password: config.password ?? undefined,
        connectTimeout: 1000,
        reconnectPeriod: 0,
      });
      return client.connected;
    } catch (e: any) {
      let estr = `${e}`;
      if (typeof e === 'object')
        estr = e.hasOwnProperty('code') ? `${e.message} (${e.code})` : e.message;
      warn('[MQTT] MQTT Config test failed: ' + estr);
      throw estr;
    }
  }

  private async destroyClient() {
    this.client.next(null);
    const client = this.client.value;
    if (!client) return;
    await client.endAsync();
    this.setClientStatus('DISCONNECTED');
  }

  private async createClient(config: MqttConfig) {
    await this.destroyClient();
    const url = this.getBrokerUrl(config);
    const client = mqtt.connect(url, {
      username: config.username ?? undefined,
      password: config.password ?? undefined,
      will: {
        topic: 'oyasumivr/available',
        payload: 'offline' as any, // Issue: https://github.com/mqttjs/mqtt-packet/pull/147
        retain: true,
      },
    });
    this.setClientStatus('DISCONNECTED');
    this.client.next(client);
    client.on('connect', async () => {
      this.setClientStatus('CONNECTED');
      await client.publishAsync('oyasumivr/available', 'online', { retain: true });
    });
    client.on('close', () => {
      this.setClientStatus('DISCONNECTED');
    });
    client.on('error', (e) => {
      this.setClientStatus('ERROR');
      console.error('[MQTT] MQTT Client error:', e);
    });
  }

  private getBrokerUrl(config: MqttConfig) {
    return `${config.secureSocket ? 'wss' : 'ws'}://${config.host}:${config.port}`;
  }

  public static mapAppSettingsToMqttConfig(settings: AppSettings): MqttConfig {
    return {
      enabled: settings.mqttEnabled,
      host: settings.mqttHost,
      port: settings.mqttPort,
      username: settings.mqttUsername,
      password: settings.mqttPassword,
      secureSocket: settings.mqttSecureSocket,
    };
  }

  private setClientStatus(status: MqttStatus) {
    if (this.clientStatus.value !== status) this.clientStatus.next(status);
  }
}
