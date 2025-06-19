import { Injectable } from '@angular/core';
import { MqttDiscoveryService } from '../mqtt-discovery.service';
import { VRChatService } from '../../vrchat-api/vrchat.service';
import { OpenVRService } from '../../openvr.service';
import { distinctUntilChanged } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class ProcessActiveMqttIntegrationService {
  constructor(
    private mqtt: MqttDiscoveryService,
    private vrchat: VRChatService,
    private openvr: OpenVRService
  ) {}

  async init() {
    await this.mqtt.initProperty({
      type: 'SENSOR',
      id: 'vrchatActive',
      topicPath: 'vrchatActive',
      displayName: 'VRChat Running',
      value: 'off',
    });
    await this.mqtt.initProperty({
      type: 'SENSOR',
      id: 'steamvrActive',
      topicPath: 'steamvrActive',
      displayName: 'SteamVR Running',
      value: 'off',
    });
    this.vrchat.vrchatProcessActive.pipe(distinctUntilChanged()).subscribe((active) => {
      this.mqtt.setSensorPropertyValue('vrchatActive', active ? 'on' : 'off');
    });
    this.openvr.status.pipe(distinctUntilChanged()).subscribe((status) => {
      this.mqtt.setSensorPropertyValue('steamvrActive', status === 'INITIALIZED' ? 'on' : 'off');
    });
  }
}
