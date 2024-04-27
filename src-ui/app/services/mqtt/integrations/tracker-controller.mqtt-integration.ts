import { Injectable } from '@angular/core';
import { MqttDiscoveryService } from '../mqtt-discovery.service';
import { OpenVRService } from '../../openvr.service';
import { LighthouseConsoleService } from '../../lighthouse-console.service';
import {
  asyncScheduler,
  concatMap,
  filter,
  pairwise,
  startWith,
  Subject,
  takeUntil,
  throttleTime,
} from 'rxjs';
import { OVRDevice, OVRDeviceClass } from '../../../models/ovr-device';
import { MqttDiscoveryConfigDevice, MqttToggleProperty } from '../../../models/mqtt';

const BATTERY_SUFFIX = 'battery';
const CHARGING_SUFFIX = 'charging';
const ROLE_SUFFIX = 'role';

@Injectable({
  providedIn: 'root',
})
export class TrackerControllerMqttIntegrationService {
  private deviceRemoved = new Subject<OVRDevice>();

  constructor(
    private mqtt: MqttDiscoveryService,
    private openvr: OpenVRService,
    private lighthouseConsole: LighthouseConsoleService
  ) {}

  async init() {
    this.openvr.devices
      .pipe(
        startWith([] as OVRDevice[]),
        throttleTime(1000, asyncScheduler, { leading: true, trailing: true }),
        pairwise(),
        concatMap(async ([prevDevices, devices]) => {
          await this.handleDeviceChanges(prevDevices, devices);
        })
      )
      .subscribe();
  }

  private async handleDeviceChanges(previousDevices: OVRDevice[], currentDevices: OVRDevice[]) {
    const addedDevices = currentDevices.filter(
      (d) => !previousDevices.some((pd) => pd.serialNumber === d.serialNumber)
    );
    const removedDevices = previousDevices.filter(
      (pd) => !currentDevices.some((d) => d.serialNumber === pd.serialNumber)
    );
    const updatedDevices = currentDevices.filter((d) =>
      previousDevices.some((pd) => pd.serialNumber === d.serialNumber)
    );
    for (let device of addedDevices) await this.addDevice(device);
    for (let device of removedDevices) await this.removeDevice(device);
    for (let device of updatedDevices) await this.updateDevice(device);
  }

  private async addDevice(device: OVRDevice) {
    let name = '';
    switch (device.class) {
      case 'Controller':
        switch (device.role) {
          case 'LeftHand':
            name = `Left Controller`;
            break;
          case 'RightHand':
            name = `Right Controller`;
            break;
          default:
            name = `Controller`;
            return;
        }
        break;
      case 'GenericTracker':
        name = `Tracker`;
        break;
      default:
        return;
    }
    const deviceDesc: MqttDiscoveryConfigDevice = {
      identifiers: [device.serialNumber],
      manufacturer: device.manufacturerName,
      model: device.modelNumber,
      name: `${name} (${device.serialNumber})`,
    };

    const roleId = this.sanitizedId(device.class, device.serialNumber, ROLE_SUFFIX);
    await this.mqtt.initProperty({
      type: 'SENSOR',
      id: roleId,
      topicPath: `device/${roleId}`,
      displayName: 'Role',
      device: deviceDesc,
      value: device.handleType ?? 'null',
    });

    const chargingId = this.sanitizedId(device.class, device.serialNumber, CHARGING_SUFFIX);
    await this.mqtt.initProperty({
      type: 'SENSOR',
      id: chargingId,
      topicPath: `device/${chargingId}`,
      displayName: 'Charging',
      available: device.canPowerOff,
      device: deviceDesc,
      value: device.isCharging ? 'on' : 'off',
    });

    const batteryId = this.sanitizedId(device.class, device.serialNumber, BATTERY_SUFFIX);
    await this.mqtt.initProperty({
      type: 'SENSOR',
      id: batteryId,
      topicPath: `device/${batteryId}`,
      displayName: 'Battery Level',
      available: device.canPowerOff,
      device: deviceDesc,
      unitOfMeasurement: '%',
      value: device.providesBatteryStatus ? `${device.battery * 100}` : 'null',
      stateClass: 'measurement',
    });

    const id = this.sanitizedId(device.class, device.serialNumber);
    await this.mqtt.initProperty({
      type: 'TOGGLE',
      id,
      topicPath: `device/${id}`,
      displayName: 'Power',
      value: device.canPowerOff,
      available: device.canPowerOff,
      device: deviceDesc,
    });

    this.mqtt
      .getCommandStreamForProperty<MqttToggleProperty>(id)
      .pipe(
        takeUntil(this.deviceRemoved.pipe(filter((d) => d.serialNumber === device.serialNumber)))
      )
      .subscribe(async (command) => {
        if (!command.current.value) {
          await this.lighthouseConsole.turnOffDevices([device]);
        }
      });
  }

  private async removeDevice(device: OVRDevice) {
    await this.mqtt.setPropertyAvailability(
      this.sanitizedId(device.class, device.serialNumber),
      false
    );
    await this.mqtt.setPropertyAvailability(
      this.sanitizedId(device.class, device.serialNumber, BATTERY_SUFFIX),
      false
    );
    this.deviceRemoved.next(device);
  }

  private async updateDevice(device: OVRDevice) {
    const id = this.sanitizedId(device.class, device.serialNumber);
    const batteryId = this.sanitizedId(device.class, device.serialNumber, BATTERY_SUFFIX);
    const chargingId = this.sanitizedId(device.class, device.serialNumber, CHARGING_SUFFIX);
    const roleId = this.sanitizedId(device.class, device.serialNumber, ROLE_SUFFIX);

    await this.mqtt.setPropertyAvailability(id, device.canPowerOff);
    await this.mqtt.setPropertyAvailability(batteryId, device.canPowerOff);
    await this.mqtt.setPropertyAvailability(chargingId, device.canPowerOff);

    await this.mqtt.setTogglePropertyValue(id, device.canPowerOff);
    await this.mqtt.setSensorPropertyValue(
      batteryId,
      device.providesBatteryStatus ? `${device.battery * 100}` : 'null'
    );
    await this.mqtt.setSensorPropertyValue(chargingId, device.isCharging ? `on` : 'off');
    await this.mqtt.setSensorPropertyValue(roleId, device.handleType ?? 'null');
  }

  private sanitizedId(deviceClass: OVRDeviceClass, name: string, suffix = '') {
    let prefix = '';
    switch (deviceClass) {
      case 'Controller':
        prefix = 'C';
        break;
      case 'GenericTracker':
        prefix = 'T';
        break;
      default:
        prefix = 'U';
        break;
    }
    return `${prefix}-${name.replace(/[^a-zA-Z0-9_-]/g, '')}${suffix ? '-' : ''}${suffix}`;
  }
}
