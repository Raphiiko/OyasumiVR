import { Injectable } from '@angular/core';
import { MqttDiscoveryService } from '../mqtt-discovery.service';
import { VRChatService } from '../../vrchat.service';
import { combineLatest, firstValueFrom } from 'rxjs';

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
    await this.mqtt.initProperty({
      type: 'SENSOR',
      id: 'vrcWorldInstanceId',
      topicPath: 'vrcWorldInstanceId',
      displayName: 'VRChat World Instance ID',
      value: 'null',
      available: false,
    });
    await this.mqtt.initProperty({
      type: 'SENSOR',
      id: 'vrcWorldPlayerCount',
      topicPath: 'vrcWorldPlayerCount',
      displayName: 'VRChat Players In World',
      value: 'null',
      available: false,
    });
    this.vrchat.user.subscribe(async (user) => {
      await this.mqtt.setSensorPropertyValue('vrcPlayerName', user?.displayName ?? 'null');
      await this.mqtt.setSensorPropertyValue(
        'vrcStatus',
        user?.status.toString() ??
          ((await firstValueFrom(this.vrchat.vrchatProcessActive)) ? 'offline' : 'null')
      );
    });
    combineLatest([this.vrchat.world, this.vrchat.vrchatProcessActive]).subscribe(
      async ([world, vrcActive]) => {
        await this.mqtt.setPropertyAvailability('vrcWorldInstanceId', world.loaded && vrcActive);
        await this.mqtt.setPropertyAvailability('vrcWorldPlayerCount', world.loaded && vrcActive);
        await this.mqtt.setSensorPropertyValue('vrcWorldInstanceId', world.instanceId ?? 'null');
        await this.mqtt.setSensorPropertyValue(
          'vrcWorldPlayerCount',
          world.playerCount.toString(10)
        );
      }
    );
  }
}
