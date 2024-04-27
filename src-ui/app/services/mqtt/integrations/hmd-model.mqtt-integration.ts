import { Injectable } from '@angular/core';
import { MqttDiscoveryService } from '../mqtt-discovery.service';
import { OpenVRService } from '../../openvr.service';
import { map } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class HMDModelMqttIntegrationService {
  constructor(private mqtt: MqttDiscoveryService, private openvr: OpenVRService) {}

  async init() {
    // Init property
    await this.mqtt.initProperty({
      type: 'SENSOR',
      id: 'hmdModel',
      topicPath: 'device/hmdModel',
      displayName: 'VR Headset Model',
      value: 'null',
      available: false,
    });
    this.openvr.status.subscribe((status) => {
      this.mqtt.setPropertyAvailability('hmdModel', status === 'INITIALIZED');
    });
    this.openvr.devices
      .pipe(map((devices) => devices.find((d) => d.class === 'HMD')))
      .subscribe((device) => {
        const name =
          [device?.manufacturerName, device?.modelNumber].filter(Boolean).join(' ') ?? 'null';
        this.mqtt.setSensorPropertyValue('hmdModel', name);
      });
  }
}
