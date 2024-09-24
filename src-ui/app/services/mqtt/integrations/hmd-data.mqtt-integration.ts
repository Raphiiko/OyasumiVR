import { Injectable } from '@angular/core';
import { MqttDiscoveryService } from '../mqtt-discovery.service';
import { OpenVRService } from '../../openvr.service';
import { map } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class HMDDataMqttIntegrationService {
  constructor(private mqtt: MqttDiscoveryService, private openvr: OpenVRService) {}

  async init() {
    // Init properties
    await this.mqtt.initProperty({
      type: 'SENSOR',
      id: 'hmdModel',
      topicPath: 'hmdModel',
      displayName: 'VR Headset Model',
      value: 'null',
      available: false,
    });
    await this.mqtt.initProperty({
      type: 'SENSOR',
      id: 'hmdOnHead',
      topicPath: 'hmdOnHead',
      displayName: 'VR HMD On Head',
      value: 'off',
      available: false,
    });
    this.openvr.status.subscribe((status) => {
      this.mqtt.setPropertyAvailability('hmdModel', status === 'INITIALIZED');
      this.mqtt.setPropertyAvailability('hmdOnHead', status === 'INITIALIZED');
    });
    this.openvr.devices
      .pipe(map((devices) => devices.find((d) => d.class === 'HMD')))
      .subscribe((device) => {
        const name =
          [device?.manufacturerName, device?.modelNumber].filter(Boolean).join(' ') ?? 'null';
        this.mqtt.setSensorPropertyValue('hmdModel', name);
        this.mqtt.setSensorPropertyValue('hmdOnHead', device?.hmdOnHead ? 'on' : 'off');
      });
  }
}
