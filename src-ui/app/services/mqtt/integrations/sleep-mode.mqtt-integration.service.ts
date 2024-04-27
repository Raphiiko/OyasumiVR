import { Injectable } from '@angular/core';
import { MqttDiscoveryService } from '../mqtt-discovery.service';
import { SleepService } from '../../sleep.service';
import { SleepPreparationService } from '../../sleep-preparation.service';
import { MqttButtonProperty, MqttToggleProperty } from '../../../models/mqtt';

@Injectable({
  providedIn: 'root',
})
export class SleepModeMqttIntegrationService {
  constructor(private mqtt: MqttDiscoveryService, private sleepService: SleepService) {}

  async init() {
    // Init property
    await this.mqtt.initProperty({
      type: 'TOGGLE',
      id: 'sleepMode',
      topicPath: 'sleepMode',
      displayName: 'Sleep Mode',
      value: false,
    });
    // Report state
    this.sleepService.mode.subscribe((mode) => {
      this.mqtt.setTogglePropertyValue('sleepMode', mode);
    });
    // Handle commands
    this.mqtt.getCommandStreamForProperty<MqttToggleProperty>('sleepMode').subscribe((command) => {
      if (command.current.value) {
        this.sleepService.enableSleepMode({ type: 'MQTT' });
      } else {
        this.sleepService.disableSleepMode({ type: 'MQTT' });
      }
    });
  }
}
