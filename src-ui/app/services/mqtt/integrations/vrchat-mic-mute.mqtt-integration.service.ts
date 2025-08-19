import { Injectable } from '@angular/core';
import { MqttDiscoveryService } from '../mqtt-discovery.service';
import { VRChatMicMuteAutomationService } from '../../osc-automations/vrchat-mic-mute-automation.service';
import { MqttToggleProperty } from '../../../models/mqtt';

@Injectable({
  providedIn: 'root',
})
export class VRChatMicMuteMqttIntegrationService {
  constructor(
    private mqtt: MqttDiscoveryService,
    private vrchatMicMute: VRChatMicMuteAutomationService
  ) {}

  async init() {
    // Init property
    await this.mqtt.initProperty({
      type: 'TOGGLE',
      id: 'vrchatMicMute',
      topicPath: 'vrchatMicMute',
      displayName: 'VRChat Microphone Mute',
      value: false,
    });
    // Report state
    this.vrchatMicMute.muted.subscribe((muted) => {
      if (muted === null) return;
      this.mqtt.setTogglePropertyValue('vrchatMicMute', muted);
    });
    // Handle commands
    this.mqtt
      .getCommandStreamForProperty<MqttToggleProperty>('vrchatMicMute')
      .subscribe((command) => {
        this.vrchatMicMute.setMute(command.current.value);
      });
  }
}