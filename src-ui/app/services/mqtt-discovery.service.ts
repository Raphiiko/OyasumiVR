import { Injectable } from '@angular/core';
import { MqttService } from './mqtt.service';
import { BehaviorSubject, distinctUntilChanged, filter, Subject } from 'rxjs';
import { MqttProperty } from '../models/mqtt';
import { getVersion } from '../utils/app-utils';
import { SleepService } from './sleep.service';
import { cloneDeep } from 'lodash';

@Injectable({
  providedIn: 'root',
})
export class MqttDiscoveryService {
  private properties = new BehaviorSubject<MqttProperty[]>([]);
  private baseDeviceConfig: Record<string, unknown> = {};
  private _propertyCommands = new Subject<{ previous: MqttProperty; current: MqttProperty }>();

  public getCommandStreamForProperty(id: string) {
    return this._propertyCommands.pipe(filter((c) => c.current.id === id));
  }

  constructor(private mqtt: MqttService, private sleepService: SleepService) {}

  async init() {
    this.baseDeviceConfig = {
      dev: {
        ids: ['oyasumivr'],
        name: 'OyasumiVR',
      },
      o: {
        name: 'OyasumiVR',
        sw: await getVersion(),
        url: 'https://oyasumivr.raphii.co',
      },
      availability_topic: 'oyasumivr/available',
    };
    await this.handleMqttConnection();
  }

  async initProperty(property: MqttProperty) {
    const properties = [...this.properties.value.filter((p) => p.id !== property.id), property];
    this.properties.next(properties);
    await this.reportConfig(property.id);
  }

  async setTogglePropertyValue(id: string, value: boolean) {
    const property = this.properties.value.find((p) => p.id === id);
    if (!property || property.type !== 'TOGGLE' || property.value === value) return;
    const properties = this.properties.value.map((p) => (p.id === id ? { ...p, value } : p));
    this.properties.next(properties);
    await this.reportState(id);
  }

  private async handleMqttConnection() {
    this.mqtt.client.pipe(distinctUntilChanged(), filter(Boolean)).subscribe(async () => {
      await this.handleCommands();
    });
    this.mqtt.clientStatus
      .pipe(
        distinctUntilChanged(),
        filter((status) => status === 'CONNECTED')
      )
      .subscribe(async () => {
        await this.reportConfig();
        await this.reportState();
        await this.handleSubscriptions();
      });
  }

  private async handleCommands() {
    const client = this.mqtt.client.value;
    if (!client) return;
    client.on('message', async (topic, payload) => {
      const parts = topic.split('/');
      if (
        parts.length === 5 &&
        parts[0] === 'homeassistant' &&
        parts[2] === 'oyasumivr' &&
        parts[4] === 'set'
      ) {
        const id = parts[3];
        const property = this.properties.value.find((p) => p.id === id);
        if (!property) return;
        switch (property.type) {
          case 'TOGGLE':
            const newValue = payload.toString() === 'ON';
            if (property.value === newValue) return;
            const previous = cloneDeep(property);
            await this.setTogglePropertyValue(id, newValue);
            const current = cloneDeep(this.properties.value.find((p) => p.id === id)!);
            this._propertyCommands.next({ previous, current });
            break;
        }
      }
    });
  }

  private async handleSubscriptions() {
    const client = this.mqtt.client.value;
    if (!client) return;
    await client.subscribeAsync('homeassistant/+/oyasumivr/+/set');
  }

  private async reportConfig(id?: string) {
    const client = this.mqtt.client.value;
    if (!client || !client.connected) return;
    if (!id) {
      for (const property of this.properties.value) {
        await this.reportConfig(property.id);
      }
      return;
    }
    const property = this.properties.value.find((p) => p.id === id);
    if (!property) return;
    switch (property.type) {
      case 'TOGGLE':
        const baseTopic = `homeassistant/switch/oyasumivr/${property.id}`;
        await client.publishAsync(
          `${baseTopic}/config`,
          JSON.stringify({
            ...this.baseDeviceConfig,
            '~': baseTopic,
            name: property.displayName,
            cmd_t: `~/set`,
            stat_t: `~/state`,
            uniq_id: property.id,
          }),
          {
            retain: true,
          }
        );
        break;
    }
  }

  private async reportState(id?: string) {
    const client = this.mqtt.client.value;
    if (!client || !client.connected) return;
    if (!id) {
      this.properties.value.forEach((property) => this.reportState(property.id));
      return;
    }
    const property = this.properties.value.find((p) => p.id === id);
    if (!property) return;
    switch (property.type) {
      case 'TOGGLE':
        await client.publishAsync(
          `homeassistant/switch/oyasumivr/${property.id}/state`,
          property.value ? 'ON' : 'OFF'
        );
        break;
    }
  }
}
