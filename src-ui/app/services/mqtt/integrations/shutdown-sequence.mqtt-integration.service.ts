import { Injectable } from '@angular/core';
import { MqttDiscoveryService } from '../mqtt-discovery.service';
import { MqttButtonProperty } from '../../../models/mqtt';
import { ShutdownAutomationsService } from '../../shutdown-automations.service';

@Injectable({
  providedIn: 'root',
})
export class ShutdownSequenceMqttIntegrationService {
  constructor(
    private mqtt: MqttDiscoveryService,
    private shutdownAutomation: ShutdownAutomationsService
  ) {}

  async init() {
    // Init property
    await this.mqtt.initProperty({
      type: 'BUTTON',
      id: 'shutdownSequence',
      topicPath: 'shutdownSequence',
      displayName: 'Shutdown Sequence',
    });
    // Handle commands
    this.mqtt.getCommandStreamForProperty<MqttButtonProperty>('shutdownSequence').subscribe(() => {
      this.shutdownAutomation.runSequence('MQTT');
    });
  }
}
