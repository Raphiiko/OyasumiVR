import { Injectable } from '@angular/core';
import { MqttDiscoveryService } from '../mqtt-discovery.service';
import { OpenVRService } from '../../openvr.service';
import { LighthouseConsoleService } from '../../lighthouse-console.service';
import {
  asyncScheduler,
  concatMap,
  filter,
  map,
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
export class HmdTrackerControllerMqttIntegrationService {
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
        map((devices) =>
          devices.filter(
            (d) => d.class === 'GenericTracker' || d.class === 'Controller' || d.class === 'HMD'
          )
        ),
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
    for (const device of addedDevices) await this.addDevice(device);
    for (const device of removedDevices) await this.removeDevice(device);
    for (const device of updatedDevices) await this.updateDevice(device);
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
            break;
        }
        break;
      case 'GenericTracker':
        name = `Tracker`;
        break;
      case 'HMD':
        name = 'Headset';
        break;
      default:
        return;
    }
    const deviceDesc: MqttDiscoveryConfigDevice = {
      identifiers: [device.serialNumber ?? ''],
      manufacturer: device.manufacturerName,
      model: device.modelNumber,
      name: `${name} (${device.serialNumber})`,
    };

    const roleId = this.sanitizedId(device.class, device.serialNumber ?? '', ROLE_SUFFIX);
    if (device.class !== 'HMD') {
      await this.mqtt.initProperty({
        type: 'SENSOR',
        id: roleId,
        topicPath: `device/${roleId}`,
        displayName: 'Role',
        device: deviceDesc,
        available: !!device.handleType,
        value: device.handleType ?? 'null',
      });
    }

    const chargingId = this.sanitizedId(device.class, device.serialNumber ?? '', CHARGING_SUFFIX);
    await this.mqtt.initProperty({
      type: 'SENSOR',
      id: chargingId,
      topicPath: `device/${chargingId}`,
      displayName: 'Charging',
      available: device.providesBatteryStatus,
      device: deviceDesc,
      value: device.isCharging ? 'on' : 'off',
    });

    const batteryId = this.sanitizedId(device.class, device.serialNumber ?? '', BATTERY_SUFFIX);
    await this.mqtt.initProperty({
      type: 'SENSOR',
      id: batteryId,
      topicPath: `device/${batteryId}`,
      displayName: 'Battery Level',
      available: device.providesBatteryStatus,
      device: deviceDesc,
      unitOfMeasurement: '%',
      value: device.providesBatteryStatus ? `${device.battery * 100}` : 'null',
      stateClass: 'measurement',
    });

    const id = this.sanitizedId(device.class, device.serialNumber ?? '');
    await this.mqtt.initProperty({
      type: 'TOGGLE',
      id,
      topicPath: `device/${id}`,
      displayName: 'Power',
      value: (device.canPowerOff ?? false) && !device.isTurningOff,
      available: (device.canPowerOff ?? false) && !device.isTurningOff,
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
    const id = this.sanitizedId(device.class, device.serialNumber ?? '');
    const batteryId = this.sanitizedId(device.class, device.serialNumber ?? '', BATTERY_SUFFIX);
    const chargingId = this.sanitizedId(device.class, device.serialNumber ?? '', CHARGING_SUFFIX);
    const roleId = this.sanitizedId(device.class, device.serialNumber ?? '', ROLE_SUFFIX);
    await this.mqtt.disposeProperty(id);
    await this.mqtt.disposeProperty(batteryId);
    await this.mqtt.disposeProperty(chargingId);
    await this.mqtt.disposeProperty(roleId);
    this.deviceRemoved.next(device);
  }

  private async updateDevice(device: OVRDevice) {
    const id = this.sanitizedId(device.class, device.serialNumber ?? '');
    const batteryId = this.sanitizedId(device.class, device.serialNumber ?? '', BATTERY_SUFFIX);
    const chargingId = this.sanitizedId(device.class, device.serialNumber ?? '', CHARGING_SUFFIX);
    const roleId = this.sanitizedId(device.class, device.serialNumber ?? '', ROLE_SUFFIX);

    await this.mqtt.setPropertyAvailability(
      id,
      (device.canPowerOff ?? false) && !device.isTurningOff
    );
    await this.mqtt.setPropertyAvailability(batteryId, device.providesBatteryStatus ?? false);
    await this.mqtt.setPropertyAvailability(chargingId, device.providesBatteryStatus ?? false);
    await this.mqtt.setPropertyAvailability(roleId, !!device.handleType);

    await this.mqtt.setTogglePropertyValue(id, device.canPowerOff ?? false);
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
