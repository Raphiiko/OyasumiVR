import { Injectable } from '@angular/core';
import { MqttDiscoveryService } from './mqtt-discovery.service';
import { SleepService } from './sleep.service';

@Injectable({
  providedIn: 'root',
})
export class MqttIntegrationService {
  constructor(private mqtt: MqttDiscoveryService, private sleepService: SleepService) {}

  async init() {
    await this.handleSleepMode();
  }

  private async handleSleepMode() {
    // Init property
    await this.mqtt.initProperty({
      type: 'TOGGLE',
      id: 'sleepMode',
      displayName: 'Sleep Mode',
      value: false,
    });
    // Report state
    this.sleepService.mode.subscribe((mode) => {
      this.mqtt.setTogglePropertyValue('sleepMode', mode);
    });
    // Handle commands
    this.mqtt.getCommandStreamForProperty('sleepMode').subscribe((command) => {
      if (command.current.value) {
        this.sleepService.enableSleepMode({ type: 'MQTT' });
      } else {
        this.sleepService.disableSleepMode({ type: 'MQTT' });
      }
    });
  }
}
