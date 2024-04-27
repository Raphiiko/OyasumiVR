import { Injectable } from '@angular/core';
import { MqttDiscoveryService } from '../mqtt-discovery.service';
import { BigscreenBeyondFanAutomationService } from '../../hmd-specific-automations/bigscreen-beyond-fan-automation.service';
import { BigscreenBeyondLedAutomationService } from '../../hmd-specific-automations/bigscreen-beyond-led-automation.service';
import { combineLatest, distinctUntilChanged, filter, map } from 'rxjs';
import { AutomationConfigService } from '../../automation-config.service';
import { MqttLightProperty, MqttNumberProperty } from '../../../models/mqtt';
import { isEqual } from 'lodash';

@Injectable({
  providedIn: 'root',
})
export class BigscreenBeyondMqttIntegrationService {
  constructor(
    private mqtt: MqttDiscoveryService,
    private fanSpeedService: BigscreenBeyondFanAutomationService,
    private ledControlService: BigscreenBeyondLedAutomationService,
    private automationConfigService: AutomationConfigService
  ) {}

  async init() {
    await this.initFanSpeedControl();
    await this.initLedControl();
  }

  private async initFanSpeedControl() {
    await this.mqtt.initProperty({
      type: 'NUMBER',
      id: 'bsbFanSpeed',
      topicPath: 'bsbFanSpeed',
      displayName: 'Fan Speed',
      value: 50,
      min: 40,
      max: 100,
      device: {
        identifiers: ['bigscreen-beyond'],
        name: 'Bigscreen Beyond',
      },
      available: false,
    });
    this.automationConfigService.configs
      .pipe(
        map((settings) => settings.BIGSCREEN_BEYOND_FAN_CONTROL.allowUnsafeFanSpeed),
        distinctUntilChanged()
      )
      .subscribe((allowUnsafeFanSpeed) => {
        this.mqtt.setNumberPropertyBounds('bsbFanSpeed', allowUnsafeFanSpeed ? 0 : 40, 100);
      });
    combineLatest([
      this.fanSpeedService.bsbConnected.pipe(distinctUntilChanged()),
      this.fanSpeedService.fanSafetyActive.pipe(distinctUntilChanged()),
    ]).subscribe(([bsbConnected, fanSafetyActive]) => {
      let available = bsbConnected && !fanSafetyActive;
      this.mqtt.setPropertyAvailability('bsbFanSpeed', available);
    });
    this.fanSpeedService.fanSafetyActive
      .pipe(distinctUntilChanged(), filter(Boolean))
      .subscribe(() => {
        this.mqtt.setNumberPropertyValue('bsbFanSpeed', 100);
      });
    this.fanSpeedService.fanSpeed.pipe(distinctUntilChanged()).subscribe((speed) => {
      this.mqtt.setNumberPropertyValue('bsbFanSpeed', speed);
    });
    this.mqtt
      .getCommandStreamForProperty<MqttNumberProperty>('bsbFanSpeed')
      .subscribe((command) => {
        this.fanSpeedService.setFanSpeed(command.current.value);
      });
  }

  private async initLedControl() {
    await this.mqtt.initProperty({
      type: 'LIGHT',
      id: 'bsbRgbLed',
      topicPath: 'bsbRgbLed',
      displayName: 'RGB LED',
      device: {
        identifiers: ['bigscreen-beyond'],
        name: 'Bigscreen Beyond',
      },
      available: false,
      state: true,
      rgbMode: true,
      rgbValue: [255, 255, 255],
    });
    this.fanSpeedService.bsbConnected.pipe(distinctUntilChanged()).subscribe((connected) => {
      this.mqtt.setPropertyAvailability('bsbRgbLed', connected);
    });
    this.ledControlService.lastSetColorExt
      .pipe(distinctUntilChanged((a, b) => isEqual(a, b)))
      .subscribe((color) => {
        this.mqtt.setLightPropertyRGBValue('bsbRgbLed', color);
      });
    this.mqtt.getCommandStreamForProperty<MqttLightProperty>('bsbRgbLed').subscribe((command) => {
      this.ledControlService.setLedColor(command.current.rgbValue, false);
    });
  }
}
