import { Injectable } from '@angular/core';
import { MqttDiscoveryService } from '../mqtt-discovery.service';
import { VRChatService } from '../../vrchat-api/vrchat.service';
import { combineLatest, firstValueFrom } from 'rxjs';
import { VRChatMicMuteAutomationService } from '../../osc-automations/vrchat-mic-mute-automation.service';
import { MqttToggleProperty } from '../../../models/mqtt';

@Injectable({
  providedIn: 'root',
})
export class VRChatMqttIntegrationService {
  constructor(
    private mqtt: MqttDiscoveryService,
    private vrchat: VRChatService,
    private micMute: VRChatMicMuteAutomationService
  ) {}

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
    await this.mqtt.initProperty({
      type: 'TOGGLE',
      id: 'vrcMicMuted',
      topicPath: 'vrcMicMuted',
      displayName: 'VRChat Microphone Muted',
      value: false,
      available: false,
    });
    this.micMute.muted.subscribe(async (muted) => {
      await this.mqtt.setPropertyAvailability('vrcMicMuted', muted !== null);
      await this.mqtt.setTogglePropertyValue('vrcMicMuted', muted ?? false);
    });
    this.mqtt
      .getCommandStreamForProperty<MqttToggleProperty>('vrcMicMuted')
      .subscribe(async (command) => {
        const muted = await firstValueFrom(this.micMute.muted);
        if (muted === null) {
          await this.mqtt.setTogglePropertyValue('vrcMicMuted', false);
          return;
        }
        await this.micMute.setMute(command.current.value);
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
          world.players.length.toString(10)
        );
      }
    );
  }
}
