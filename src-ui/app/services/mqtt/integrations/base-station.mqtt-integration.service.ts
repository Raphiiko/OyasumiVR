import { Injectable } from '@angular/core';
import { MqttDiscoveryService } from '../mqtt-discovery.service';
import { LighthouseService } from '../../lighthouse.service';
import { concatMap, filter, pairwise, startWith, Subject, takeUntil } from 'rxjs';
import { LighthouseDevice } from '../../../models/lighthouse-device';
import { MqttDiscoveryConfigDevice, MqttToggleProperty } from '../../../models/mqtt';
import { cloneDeep } from 'lodash';
import { APP_SETTINGS_DEFAULT, AppSettings } from '../../../models/settings';
import { AppSettingsService } from '../../app-settings.service';

const POWER_STATE_SUFFIX = 'power_state';

@Injectable({
  providedIn: 'root',
})
export class BaseStationMqttIntegrationService {
  private deviceRemoved = new Subject<LighthouseDevice>();
  private appSettings: AppSettings = cloneDeep(APP_SETTINGS_DEFAULT);

  constructor(
    private mqtt: MqttDiscoveryService,
    private lighthouseService: LighthouseService,
    private appSettingsService: AppSettingsService
  ) {}

  async init() {
    this.appSettingsService.settings.subscribe((settings) => {
      this.appSettings = settings;
    });
    this.lighthouseService.devices
      .pipe(
        startWith([] as LighthouseDevice[]),
        pairwise(),
        concatMap(async ([prevDevices, devices]) => {
          await this.handleDeviceChanges(prevDevices, devices);
        })
      )
      .subscribe();
  }

  private async handleDeviceChanges(
    previousDevices: LighthouseDevice[],
    currentDevices: LighthouseDevice[]
  ) {
    const addedDevices = currentDevices.filter(
      (d) => !previousDevices.some((pd) => pd.id === d.id)
    );
    const removedDevices = previousDevices.filter(
      (pd) => !currentDevices.some((d) => d.id === pd.id)
    );
    const updatedDevices = currentDevices.filter((d) =>
      previousDevices.some((pd) => pd.id === d.id)
    );
    for (let device of addedDevices) await this.addDevice(device);
    for (let device of removedDevices) await this.removeDevice(device);
    for (let device of updatedDevices) await this.updateDevice(device);
  }

  private async addDevice(device: LighthouseDevice) {
    const deviceDesc: MqttDiscoveryConfigDevice = {
      identifiers: [this.sanitizedId(device.id)],
      name: `Base Station (${device.deviceName})`,
      model: device.deviceType,
    };

    const powerStateId = this.sanitizedId(device.id, POWER_STATE_SUFFIX);
    await this.mqtt.initProperty({
      type: 'SENSOR',
      id: powerStateId,
      topicPath: `device/${powerStateId}`,
      displayName: 'Power State',
      value: device.powerState,
      device: deviceDesc,
    });

    const id = this.sanitizedId(device.id);
    await this.mqtt.initProperty({
      type: 'TOGGLE',
      id,
      topicPath: `device/${id}`,
      displayName: 'Power',
      value: device.powerState === 'on' || device.powerState === 'booting',
      available:
        device.powerState === 'on' ||
        device.powerState === 'sleep' ||
        device.powerState === 'standby',
      device: deviceDesc,
    });

    this.mqtt
      .getCommandStreamForProperty<MqttToggleProperty>(id)
      .pipe(takeUntil(this.deviceRemoved.pipe(filter((d) => d.id === id))))
      .subscribe(async (command) => {
        if (command.current.value) {
          await this.lighthouseService.setPowerState(device, 'on');
        } else {
          await this.lighthouseService.setPowerState(
            device,
            this.appSettings.lighthousePowerOffState
          );
        }
      });
  }

  private async removeDevice(device: LighthouseDevice) {
    await this.mqtt.setPropertyAvailability(this.sanitizedId(device.id), false);
    this.deviceRemoved.next(device);
  }

  private async updateDevice(device: LighthouseDevice) {
    const id = this.sanitizedId(device.id);
    await this.mqtt.setPropertyAvailability(
      id,
      device.powerState === 'on' || device.powerState === 'sleep' || device.powerState === 'standby'
    );
    await this.mqtt.setTogglePropertyValue(
      id,
      device.powerState === 'on' || device.powerState === 'booting'
    );
    await this.mqtt.setSensorPropertyValue(
      this.sanitizedId(device.id, POWER_STATE_SUFFIX),
      device.powerState
    );
  }

  private sanitizedId(name: string, suffix = '') {
    return `LH-${name.replace(/[^a-zA-Z0-9_-]/g, '')}${suffix ? '-' : ''}${suffix}`;
  }
}
