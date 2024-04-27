import { Injectable } from '@angular/core';
import { MqttDiscoveryService } from '../mqtt-discovery.service';
import { SleepPreparationService } from '../../sleep-preparation.service';
import { MqttButtonProperty } from '../../../models/mqtt';

@Injectable({
  providedIn: 'root',
})
export class SleepPreparationMqttIntegrationService {
  constructor(
    private mqtt: MqttDiscoveryService,
    private sleepPreparation: SleepPreparationService
  ) {}

  async init() {
    // Init property
    await this.mqtt.initProperty({
      type: 'BUTTON',
      id: 'sleepPreparation',
      topicPath: 'sleepPreparation',
      displayName: 'Sleep Preparation',
    });
    // Handle commands
    this.mqtt
      .getCommandStreamForProperty<MqttButtonProperty>('sleepPreparation')
      .subscribe((command) => {
        this.sleepPreparation.prepareForSleep();
      });
  }
}
