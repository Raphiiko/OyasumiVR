import { Injectable } from '@angular/core';
import { MqttDiscoveryService } from '../mqtt-discovery.service';
import { SimpleBrightnessControlService } from '../../brightness-control/simple-brightness-control.service';
import { HardwareBrightnessControlService } from '../../brightness-control/hardware-brightness-control.service';
import { SoftwareBrightnessControlService } from '../../brightness-control/software-brightness-control.service';
import { combineLatest, distinctUntilChanged, map } from 'rxjs';
import { MqttNumberProperty, MqttToggleProperty } from '../../../models/mqtt';
import { AutomationConfigService } from '../../automation-config.service';
import { isEqual } from 'lodash';
import { ensurePrecision } from '../../../utils/number-utils';
import { BrightnessAutomationsConfig } from '../../../models/automations';
import { CCTControlService } from '../../cct-control/cct-control.service';
import { AppSettingsService } from '../../app-settings.service';

@Injectable({
  providedIn: 'root',
})
export class BrightnessMqttIntegrationService {
  advancedMode = false;
  hwDriverAvailable = false;

  constructor(
    private mqtt: MqttDiscoveryService,
    private simpleBrightness: SimpleBrightnessControlService,
    private hwBrightness: HardwareBrightnessControlService,
    private swBrightness: SoftwareBrightnessControlService,
    private automationConfigService: AutomationConfigService,
    private cctControl: CCTControlService,
    private appSettingsService: AppSettingsService
  ) {}

  async init() {
    await this.initSimpleBrightness();
    await this.initHardwareBrightness();
    await this.initSoftwareBrightness();
    await this.initAdvancedMode();
    await this.initColorTemperature();
  }

  private async initSimpleBrightness() {
    await this.mqtt.initProperty({
      type: 'NUMBER',
      id: 'simpleBrightness',
      topicPath: 'simpleBrightness',
      displayName: 'Brightness',
      value: 100,
      min: 5,
      max: 100,
      available: false,
      unitOfMeasurement: '%',
    });
    this.simpleBrightness.brightnessStream.pipe(distinctUntilChanged()).subscribe((brightness) => {
      this.mqtt.setNumberPropertyValue('simpleBrightness', ensurePrecision(brightness, 0));
    });
    this.mqtt
      .getCommandStreamForProperty<MqttNumberProperty>('simpleBrightness')
      .subscribe((command) => {
        if (this.advancedMode) return;
        this.simpleBrightness.setBrightness(command.current.value);
      });
  }

  private async initHardwareBrightness() {
    this.hwBrightness.driverIsAvailable.subscribe((available) => {
      this.hwDriverAvailable = available;
    });
    await this.mqtt.initProperty({
      type: 'NUMBER',
      id: 'hardwareBrightness',
      topicPath: 'hardwareBrightness',
      displayName: 'Hardware Brightness',
      value: 100,
      min: 100,
      max: 100,
      available: false,
      unitOfMeasurement: '%',
    });
    this.hwBrightness.brightnessBounds
      .pipe(distinctUntilChanged((a, b) => isEqual(a, b)))
      .subscribe(([min, max]) => {
        this.mqtt.setNumberPropertyBounds('hardwareBrightness', min, max);
      });
    this.hwBrightness.brightnessStream.pipe(distinctUntilChanged()).subscribe((brightness) => {
      this.mqtt.setNumberPropertyValue('hardwareBrightness', ensurePrecision(brightness, 0));
    });
    this.mqtt
      .getCommandStreamForProperty<MqttNumberProperty>('hardwareBrightness')
      .subscribe((command) => {
        if (!this.advancedMode || !this.hwDriverAvailable) return;
        this.hwBrightness.setBrightness(command.current.value);
      });
  }

  private async initSoftwareBrightness() {
    await this.mqtt.initProperty({
      type: 'NUMBER',
      id: 'softwareBrightness',
      topicPath: 'softwareBrightness',
      displayName: 'Software Brightness',
      value: 100,
      min: 5,
      max: 100,
      available: false,
      unitOfMeasurement: '%',
    });
    this.swBrightness.brightnessStream.pipe(distinctUntilChanged()).subscribe((brightness) => {
      this.mqtt.setNumberPropertyValue('softwareBrightness', ensurePrecision(brightness, 0));
    });
    this.mqtt
      .getCommandStreamForProperty<MqttNumberProperty>('softwareBrightness')
      .subscribe((command) => {
        if (!this.advancedMode) return;
        this.swBrightness.setBrightness(command.current.value);
      });
  }

  private async initAdvancedMode() {
    await this.mqtt.initProperty({
      type: 'TOGGLE',
      id: 'advancedBrightnessMode',
      topicPath: 'advancedBrightnessMode',
      displayName: 'Advanced Brightness Mode',
      value: false,
    });
    this.simpleBrightness.advancedMode.pipe(distinctUntilChanged()).subscribe((mode) => {
      this.advancedMode = mode;
      this.mqtt.setTogglePropertyValue('advancedBrightnessMode', mode);
      this.mqtt.setPropertyAvailability('hardwareBrightness', mode);
      this.mqtt.setPropertyAvailability('softwareBrightness', mode);
      this.mqtt.setPropertyAvailability('simpleBrightness', !mode);
    });
    this.mqtt
      .getCommandStreamForProperty<MqttToggleProperty>('advancedBrightnessMode')
      .subscribe((command) => {
        this.automationConfigService.updateAutomationConfig<BrightnessAutomationsConfig>(
          'BRIGHTNESS_AUTOMATIONS',
          { advancedMode: command.current.value }
        );
      });
  }

  private async initColorTemperature() {
    await this.mqtt.initProperty({
      type: 'NUMBER',
      id: 'colorTemperature',
      topicPath: 'colorTemperature',
      displayName: 'Color Temperature',
      value: this.cctControl.cct,
      min: 1000,
      max: 10000,
      mode: 'slider',
      available: false,
      unitOfMeasurement: 'K',
    });
    combineLatest([
      this.appSettingsService.settings.pipe(map((settings) => settings.cctControlEnabled)),
      this.cctControl.driverIsAvailable,
    ])
      .pipe(
        map(([enabled, available]) => enabled && available),
        distinctUntilChanged()
      )
      .subscribe((available) => this.mqtt.setPropertyAvailability('colorTemperature', available));
    this.cctControl.cctStream.pipe(distinctUntilChanged()).subscribe((cct) => {
      this.mqtt.setNumberPropertyValue('colorTemperature', cct);
    });
    this.mqtt
      .getCommandStreamForProperty<MqttNumberProperty>('colorTemperature')
      .subscribe((command) => this.applyColorTemperatureCommand(command.current.value));
  }

  private async applyColorTemperatureCommand(cct: number) {
    await this.cctControl.setCCT(cct);
    // setCCT rounds, clamps, or ignores the value, and an unchanged cctStream does not re-emit
    await this.mqtt.setNumberPropertyValue('colorTemperature', this.cctControl.cct);
  }
}
