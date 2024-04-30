import { Injectable } from '@angular/core';
import { MqttService } from './mqtt.service';
import { BehaviorSubject, distinctUntilChanged, filter, Observable, Subject } from 'rxjs';
import {
  MqttDiscoveryConfigBase,
  MqttLightProperty,
  MqttNumberProperty,
  MqttProperty,
  MqttSensorProperty,
  MqttToggleProperty,
} from '../../models/mqtt';
import { getVersion } from '../../utils/app-utils';
import { SleepService } from '../sleep.service';
import { cloneDeep } from 'lodash';

@Injectable({
  providedIn: 'root',
})
export class MqttDiscoveryService {
  private properties = new BehaviorSubject<MqttProperty[]>([]);
  private baseConfig?: MqttDiscoveryConfigBase;
  private _propertyCommands = new Subject<{ previous: MqttProperty; current: MqttProperty }>();

  public getCommandStreamForProperty<T extends MqttProperty>(id: string) {
    return this._propertyCommands.pipe(filter((c) => c.current.id === id)) as Observable<{
      previous: T;
      current: T;
    }>;
  }

  constructor(private mqtt: MqttService, private sleepService: SleepService) {}

  async init() {
    this.baseConfig = {
      device: {
        identifiers: ['oyasumivr'],
        name: 'OyasumiVR',
      },
      origin: {
        name: 'OyasumiVR',
        sw_version: await getVersion(),
        support_url: 'https://oyasumivr.raphii.co',
      },
      availability: [
        {
          topic: 'OyasumiVR/available',
        },
      ],
      availability_mode: 'all',
    };
    await this.handleMqttConnection();
  }

  async initProperty(property: MqttProperty) {
    const properties = [...this.properties.value.filter((p) => p.id !== property.id), property];
    this.properties.next(properties);
    await this.reportConfig(property.id);
    await this.reportState(property.id);
    await this.reportAvailability(property.id);
  }

  async setTogglePropertyValue(id: string, value: boolean) {
    const property = this.properties.value.find((p) => p.id === id);
    if (!property || property.type !== 'TOGGLE' || property.value === value) return;
    const properties = this.properties.value.map((p) =>
      p.id === id ? ({ ...p, value } as MqttToggleProperty) : p
    );
    this.properties.next(properties);
    await this.reportState(id);
  }

  async setSensorPropertyValue(id: string, value: string) {
    const property = this.properties.value.find((p) => p.id === id);
    if (!property || property.type !== 'SENSOR' || property.value === value) return;
    const properties = this.properties.value.map((p) =>
      p.id === id ? ({ ...p, value } as MqttSensorProperty) : p
    );
    this.properties.next(properties);
    await this.reportState(id);
  }

  async setNumberPropertyValue(id: string, value: number) {
    const property = this.properties.value.find((p) => p.id === id);
    if (!property || property.type !== 'NUMBER' || property.value === value) return;
    const properties = this.properties.value.map((p) =>
      p.id === id ? ({ ...p, value } as MqttNumberProperty) : p
    );
    this.properties.next(properties);
    await this.reportState(id);
  }

  async setNumberPropertyBounds(id: string, min: number, max: number) {
    const property = this.properties.value.find((p) => p.id === id);
    if (!property || property.type !== 'NUMBER' || (property.min === min && property.max === max))
      return;
    const properties = this.properties.value.map((p) =>
      p.id === id ? ({ ...p, min, max } as MqttNumberProperty) : p
    );
    this.properties.next(properties);
    await this.reportConfig(id);
  }

  async setLightPropertyRGBValue(id: string, rgb: [number, number, number]) {
    const property = this.properties.value.find((p) => p.id === id);
    const newState = !rgb.every((v) => v === 0);
    if (
      !property ||
      property.type !== 'LIGHT' ||
      !property.rgbMode ||
      (property.rgbValue[0] === rgb[0] &&
        property.rgbValue[1] === rgb[1] &&
        property.rgbValue[2] === rgb[2] &&
        property.state === newState)
    )
      return;
    const properties = this.properties.value.map((p) =>
      p.id === id ? ({ ...p, rgbValue: rgb, state: newState } as MqttLightProperty) : p
    );
    this.properties.next(properties);
    await this.reportState(id);
  }

  async setPropertyAvailability(id: string, available: boolean) {
    const property = this.properties.value.find((p) => p.id === id);
    if (!property || property.available === available) return;
    property.available = available;
    await this.reportAvailability(id);
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
        await this.reportAvailability();
        await this.handleSubscriptions();
      });
  }

  private async handleCommands() {
    const client = this.mqtt.client.value;
    if (!client) return;
    client.on('message', async (topic, payload) => {
      const parts = topic.split('/');
      if (parts[0] === 'OyasumiVR') {
        const action = parts[parts.length - 1];
        switch (action) {
          case 'set':
          case 'rgbSet': {
            const topicPath = parts.slice(1, -1).join('/');
            const property = this.properties.value.find((p) => p.topicPath === topicPath);
            if (!property) return;
            switch (property.type) {
              case 'TOGGLE': {
                const newValue = payload.toString() === 'ON';
                if (property.value === newValue) return;
                const previous = cloneDeep(property);
                await this.setTogglePropertyValue(property.id, newValue);
                const current = cloneDeep(this.properties.value.find((p) => p.id === property.id)!);
                this._propertyCommands.next({ previous, current });
                break;
              }
              case 'BUTTON': {
                this._propertyCommands.next({ previous: property, current: property });
                break;
              }
              case 'NUMBER': {
                const newValue = parseFloat(payload.toString());
                if (isNaN(newValue) || property.value === newValue) return;
                const previous = cloneDeep(property);
                await this.setNumberPropertyValue(property.id, newValue);
                const current = cloneDeep(this.properties.value.find((p) => p.id === property.id)!);
                this._propertyCommands.next({ previous, current });
                break;
              }
              case 'LIGHT': {
                switch (action) {
                  case 'set': {
                    const newValue = payload.toString() === 'ON';
                    const previous = cloneDeep(property);
                    if (newValue && property.rgbValue.every((v) => v === 0))
                      property.rgbValue = [255, 255, 255];
                    await this.setLightPropertyRGBValue(
                      property.id,
                      newValue ? property.rgbValue : [0, 0, 0]
                    );
                    const current = cloneDeep(
                      this.properties.value.find((p) => p.id === property.id)!
                    );
                    this._propertyCommands.next({ previous, current });
                    break;
                  }
                  case 'rgbSet': {
                    const newValue = payload
                      .toString()
                      .split(',')
                      .map((v) => parseInt(v, 10));
                    if (newValue.length !== 3) return;
                    const previous = cloneDeep(property);
                    await this.setLightPropertyRGBValue(
                      property.id,
                      newValue as [number, number, number]
                    );
                    const current = cloneDeep(
                      this.properties.value.find((p) => p.id === property.id)!
                    );
                    this._propertyCommands.next({ previous, current });
                    break;
                  }
                }
                break;
              }
            }
            break;
          }
        }
      }
    });
  }

  private async handleSubscriptions() {
    const client = this.mqtt.client.value;
    if (!client) return;
    await client.subscribeAsync([
      'OyasumiVR/+/set',
      'OyasumiVR/+/rgbSet',
      'OyasumiVR/device/+/set',
      'OyasumiVR/device/+/rgbSet',
    ]);
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
    const baseConfig = cloneDeep(this.baseConfig)!;
    if (property.available !== undefined) {
      baseConfig.availability.push({
        topic: `OyasumiVR/${property.topicPath}/available`,
      });
    }
    baseConfig.device_class = property.deviceClass;
    if (property.device) baseConfig.device = property.device;
    switch (property.type) {
      case 'TOGGLE': {
        await client.publishAsync(
          `homeassistant/switch/OyasumiVR/${property.id}/config`,
          JSON.stringify({
            ...baseConfig,
            name: property.displayName,
            command_topic: `OyasumiVR/${property.topicPath}/set`,
            state_topic: `OyasumiVR/${property.topicPath}/state`,
            unique_id: property.id,
          }),
          {
            retain: true,
          }
        );
        break;
      }
      case 'BUTTON': {
        await client.publishAsync(
          `homeassistant/button/OyasumiVR/${property.id}/config`,
          JSON.stringify({
            ...baseConfig,
            name: property.displayName,
            command_topic: `OyasumiVR/${property.topicPath}/set`,
            unique_id: property.id,
          }),
          {
            retain: true,
          }
        );
        break;
      }
      case 'SENSOR': {
        await client.publishAsync(
          `homeassistant/sensor/OyasumiVR/${property.id}/config`,
          JSON.stringify({
            ...baseConfig,
            name: property.displayName,
            state_topic: `OyasumiVR/${property.topicPath}/state`,
            unique_id: property.id,
            state_class: property.stateClass,
            unit_of_measurement: property.unitOfMeasurement,
          }),
          {
            retain: true,
          }
        );
        break;
      }
      case 'NUMBER': {
        await client.publishAsync(
          `homeassistant/number/OyasumiVR/${property.id}/config`,
          JSON.stringify({
            ...baseConfig,
            name: property.displayName,
            command_topic: `OyasumiVR/${property.topicPath}/set`,
            state_topic: `OyasumiVR/${property.topicPath}/state`,
            unique_id: property.id,
            unit_of_measurement: property.unitOfMeasurement,
            min: property.min ?? 0,
            max: property.max ?? 100,
          }),
          {
            retain: true,
          }
        );
        break;
      }
      case 'LIGHT': {
        const config: any = {
          ...baseConfig,
          name: property.displayName,
          command_topic: `OyasumiVR/${property.topicPath}/set`,
          state_topic: `OyasumiVR/${property.topicPath}/state`,
          unique_id: property.id,
        };
        if (property.rgbMode) {
          config['rgb_command_topic'] = `OyasumiVR/${property.topicPath}/rgbSet`;
          config['rgb_state_topic'] = `OyasumiVR/${property.topicPath}/rgbState`;
        }
        await client.publishAsync(
          `homeassistant/light/OyasumiVR/${property.id}/config`,
          JSON.stringify(config),
          {
            retain: true,
          }
        );
        break;
      }
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
      case 'TOGGLE': {
        await client.publishAsync(
          `OyasumiVR/${property.topicPath}/state`,
          property.value ? 'ON' : 'OFF'
        );
        break;
      }
      case 'SENSOR': {
        await client.publishAsync(`OyasumiVR/${property.topicPath}/state`, property.value);
        break;
      }
      case 'NUMBER': {
        await client.publishAsync(
          `OyasumiVR/${property.topicPath}/state`,
          property.value.toString(10)
        );
        break;
      }
      case 'LIGHT': {
        if (property.rgbMode) {
          await client.publishAsync(
            `OyasumiVR/${property.topicPath}/rgbState`,
            property.rgbValue.join(',')
          );
          if (property.rgbValue.every((v) => v === 0)) {
            property.state = false;
          }
        }
        await client.publishAsync(
          `OyasumiVR/${property.topicPath}/state`,
          property.state ? 'ON' : 'OFF'
        );
      }
    }
  }

  private async reportAvailability(id?: string) {
    const client = this.mqtt.client.value;
    if (!client || !client.connected) return;
    if (!id) {
      this.properties.value.forEach((property) => this.reportAvailability(property.id));
      return;
    }
    const property = this.properties.value.find((p) => p.id === id);
    if (!property || property.available === undefined) return;
    await client.publishAsync(
      `OyasumiVR/${property.topicPath}/available`,
      property.available ? 'online' : 'offline'
    );
  }
}
