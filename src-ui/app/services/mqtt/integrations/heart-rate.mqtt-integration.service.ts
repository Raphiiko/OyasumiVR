import { Injectable } from '@angular/core';
import { MqttDiscoveryService } from '../mqtt-discovery.service';
import { PulsoidService } from '../../integrations/pulsoid.service';

@Injectable({
  providedIn: 'root',
})
export class HeartRateMqttIntegrationService {
  constructor(private mqtt: MqttDiscoveryService, private pulsoid: PulsoidService) {}

  async init() {
    // Init property
    await this.mqtt.initProperty({
      type: 'SENSOR',
      id: 'heartRate',
      topicPath: 'heartRate',
      displayName: 'Heart Rate',
      unitOfMeasurement: 'bpm',
      stateClass: 'measurement',
      value: 'null',
    });
    // Report state
    this.pulsoid.heartRate.subscribe((number) => {
      this.mqtt.setSensorPropertyValue('heartRate', number?.toString(10) ?? 'null');
      this.mqtt.setPropertyAvailability('heartRate', number !== null);
    });
  }
}
