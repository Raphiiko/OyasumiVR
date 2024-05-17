import { Injectable } from '@angular/core';
import { MqttDiscoveryService } from '../mqtt-discovery.service';
import { SleepService } from '../../sleep.service';
import { distinctUntilChanged } from 'rxjs';
import { OpenVRService } from '../../openvr.service';

@Injectable({
  providedIn: 'root',
})
export class SleepingPositionMqttIntegrationService {
  constructor(
    private mqtt: MqttDiscoveryService,
    private sleepService: SleepService,
    private openvr: OpenVRService
  ) {}

  async init() {
    // Init property
    await this.mqtt.initProperty({
      type: 'SENSOR',
      id: 'sleepingPosition',
      topicPath: 'sleepingPosition',
      displayName: 'Sleeping Position',
      value: 'null',
      available: false,
    });
    this.openvr.status.subscribe((status) => {
      this.mqtt.setPropertyAvailability('sleepingPosition', status === 'INITIALIZED');
    });
    this.sleepService.pose.pipe(distinctUntilChanged()).subscribe((pose) => {
      this.mqtt.setSensorPropertyValue('sleepingPosition', pose);
    });
  }
}
