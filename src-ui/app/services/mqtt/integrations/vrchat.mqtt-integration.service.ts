import { Injectable } from '@angular/core';
import { MqttDiscoveryService } from '../mqtt-discovery.service';
import { VRChatService } from '../../vrchat.service';
import { firstValueFrom } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class VRChatMqttIntegrationService {
  constructor(private mqtt: MqttDiscoveryService, private vrchat: VRChatService) {}

  async init() {
    await this.mqtt.initProperty({
      type: 'SENSOR',
      id: 'vrcStatus',
      topicPath: 'vrcStatus',
      displayName: 'VRChat Status',
      value: 'null',
    });
    await this.mqtt.initProperty({
      type: 'SENSOR',
      id: 'vrcPlayerName',
      topicPath: 'vrcPlayerName',
      displayName: 'VRChat Player Name',
      value: 'null',
    });
    this.vrchat.user.subscribe(async (user) => {
      await this.mqtt.setSensorPropertyValue('vrcPlayerName', user?.displayName ?? 'null');
      await this.mqtt.setSensorPropertyValue(
        'vrcStatus',
        user?.status.toString() ??
          ((await firstValueFrom(this.vrchat.vrchatProcessActive)) ? 'offline' : 'null')
      );
    });
  }
}
