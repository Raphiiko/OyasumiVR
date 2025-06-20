import { Injectable } from '@angular/core';
import {
  asyncScheduler,
  BehaviorSubject,
  distinctUntilChanged,
  firstValueFrom,
  map,
  switchMap,
  tap,
  throttleTime,
} from 'rxjs';
import { v4 as uuidv4 } from 'uuid';
import {
  DEVICE_MANAGER_DATA_DEFAULT,
  DeviceManagerData,
  DeviceSelection,
  DMDeviceTag,
  DMDeviceType,
  DMKnownDevice,
} from '../models/device-manager';
import { migrateDeviceManagerData } from '../migrations/device-manager.migrations';
import { SETTINGS_KEY_DEVICE_MANAGER, SETTINGS_STORE } from '../globals';
import { OpenVRService } from './openvr.service';
import { LighthouseService } from './lighthouse.service';
import { OVRDevice } from '../models/ovr-device';
import { LighthouseDevice } from '../models/lighthouse-device';
import { isEqual, uniq } from 'lodash';
import { error } from '@tauri-apps/plugin-log';

@Injectable({
  providedIn: 'root',
})
export class DeviceManagerService {
  private _data = new BehaviorSubject<DeviceManagerData>(DEVICE_MANAGER_DATA_DEFAULT);
  private _observedDevices = new BehaviorSubject<string[]>([]);

  public readonly observedDevices = this._observedDevices.asObservable();
  public readonly knownDevices = this._data.pipe(map((data) => data.knownDevices));
  public readonly tags = this._data.pipe(map((data) => data.tags));

  constructor(
    private openvr: OpenVRService,
    private lighthouse: LighthouseService
  ) {}

  async init() {
    await this.loadData();
    this.listenForOpenVRDevices();
    this.listenForLighthouseDevices();
    this._data
      .pipe(
        throttleTime(2000, asyncScheduler, { leading: true, trailing: true }),
        switchMap(() => this.saveData())
      )
      .subscribe();
  }

  public getKnownDeviceById(id: string): DMKnownDevice | undefined {
    return this._data.value.knownDevices.find((device) => device.id === id);
  }

  public getTagById(id: string) {
    return this._data.value.tags.find((tag) => tag.id === id);
  }

  public getTagsForKnownDevice(device: DMKnownDevice) {
    return this._data.value.tags.filter((tag) => device.tagIds.includes(tag.id));
  }

  public addTagToKnownDevice(device: DMKnownDevice, tag: DMDeviceTag): DMKnownDevice {
    const patchedDevice = structuredClone(
      this._data.value.knownDevices.find((d) => d.id === device.id)
    );
    if (!patchedDevice) return device;
    patchedDevice.tagIds = uniq([...patchedDevice.tagIds, tag.id]);
    this._data.next({
      ...this._data.value,
      knownDevices: this._data.value.knownDevices.map((d) =>
        d.id === device.id ? patchedDevice : d
      ),
    });
    return patchedDevice;
  }

  public removeTagFromKnownDevice(device: DMKnownDevice, tag: DMDeviceTag): DMKnownDevice {
    const patchedDevice = structuredClone(
      this._data.value.knownDevices.find((d) => d.id === device.id)
    );
    if (!patchedDevice) return device;
    patchedDevice.tagIds = patchedDevice.tagIds.filter((id) => id !== tag.id);
    this._data.next({
      ...this._data.value,
      knownDevices: this._data.value.knownDevices.map((d) =>
        d.id === device.id ? patchedDevice : d
      ),
    });
    return patchedDevice;
  }

  public forgetKnownDevice(device: DMKnownDevice): DMKnownDevice {
    const patchedDevice = structuredClone(
      this._data.value.knownDevices.find((d) => d.id === device.id)
    );
    if (!patchedDevice) return device;
    this._data.next({
      ...this._data.value,
      knownDevices: this._data.value.knownDevices.filter((d) => d.id !== device.id),
    });
    return patchedDevice;
  }

  public setNicknameForKnownDevice(device: DMKnownDevice, nickname?: string): DMKnownDevice {
    if (nickname) nickname = nickname.trim();
    if (!nickname) nickname = undefined;
    const patchedDevice = structuredClone(
      this._data.value.knownDevices.find((d) => d.id === device.id)
    );
    if (!patchedDevice) return device;
    if (nickname) patchedDevice.nickname = nickname;
    else patchedDevice.nickname = undefined;
    this._data.next({
      ...this._data.value,
      knownDevices: this._data.value.knownDevices.map((d) =>
        d.id === device.id ? patchedDevice : d
      ),
    });
    return patchedDevice;
  }

  public createTag(name: string, color: string): DMDeviceTag {
    const tag: DMDeviceTag = {
      id: `TAG_${uuidv4()}`,
      name: name.trim(),
      color,
    };
    this._data.next({
      ...this._data.value,
      tags: [...this._data.value.tags, tag],
    });
    return tag;
  }

  public updateTag(tagId: string, name: string, color: string) {
    this._data.next({
      ...this._data.value,
      tags: this._data.value.tags.map((tag) =>
        tag.id === tagId ? { ...tag, name: name.trim(), color } : tag
      ),
    });
  }

  public deleteTag(tagId: string) {
    this._data.next({
      ...this._data.value,
      tags: this._data.value.tags.filter((tag) => tag.id !== tagId),
      knownDevices: this._data.value.knownDevices.map((device) => ({
        ...device,
        tagIds: device.tagIds.filter((id) => id !== tagId),
      })),
    });
  }

  public isDeviceObserved(deviceId: string): boolean {
    return this._observedDevices.value.includes(deviceId);
  }

  public async getDevicesForSelection(selection: DeviceSelection): Promise<{
    lighthouseDevices: LighthouseDevice[];
    ovrDevices: OVRDevice[];
    knownDevices: DMKnownDevice[];
  }> {
    const result: {
      lighthouseDevices: LighthouseDevice[];
      ovrDevices: OVRDevice[];
      knownDevices: DMKnownDevice[];
    } = {
      lighthouseDevices: [],
      ovrDevices: [],
      knownDevices: [],
    };

    // Device types
    for (const type of selection.types) {
      result.knownDevices.push(
        ...this._data.value.knownDevices.filter((d) => d.deviceType === type)
      );
      switch (type) {
        case 'HMD':
        case 'CONTROLLER':
        case 'TRACKER': {
          const devices = await firstValueFrom(this.openvr.devices);
          switch (type) {
            case 'HMD':
              result.ovrDevices.push(...devices.filter((d) => d.class === 'HMD'));
              break;
            case 'CONTROLLER':
              result.ovrDevices.push(...devices.filter((d) => d.class === 'Controller'));
              break;
            case 'TRACKER':
              result.ovrDevices.push(...devices.filter((d) => d.class === 'GenericTracker'));
              break;
          }
          break;
        }
        case 'LIGHTHOUSE': {
          const _devices = await firstValueFrom(this.lighthouse.devices);
          result.lighthouseDevices.push(..._devices);
          break;
        }
        default:
          error(
            `[DeviceManagerService] getDevicesForSelection attempted to get devices for unknown device type (${type})`
          );
          break;
      }
    }

    // Device tags
    const openvrDevices = await firstValueFrom(this.openvr.devices);
    const lighthouseDevices = await firstValueFrom(this.lighthouse.devices);
    for (const tagId of selection.tagIds) {
      const devices = this._data.value.knownDevices.filter((d) => d.tagIds.includes(tagId));
      for (const device of devices) {
        if (!result.knownDevices.find((d) => d.id === device.id)) {
          result.knownDevices.push(device);
        }
        const ovrDeviceId = this.getOpenVRIdForKnownDevice(device);
        const ovrDevice = openvrDevices.find((d) => d.serialNumber === ovrDeviceId);
        if (ovrDevice && !result.ovrDevices.find((d) => d.serialNumber === ovrDeviceId))
          result.ovrDevices.push(ovrDevice);
        else {
          const lighthouseDeviceId = this.getLighthouseIdForKnownDevice(device);
          const lighthouseDevice = lighthouseDevices.find((d) => d.id === lighthouseDeviceId);
          if (
            lighthouseDevice &&
            !result.lighthouseDevices.find((d) => d.id === lighthouseDeviceId)
          )
            result.lighthouseDevices.push(lighthouseDevice);
        }
      }
    }

    // Individual devices
    for (const deviceId of selection.devices) {
      const device = this.getKnownDeviceById(deviceId);
      if (!device) continue;
      if (!result.knownDevices.find((d) => d.id === device.id)) {
        result.knownDevices.push(device);
      }
      const ovrDeviceId = this.getOpenVRIdForKnownDevice(device);
      const ovrDevice = openvrDevices.find((d) => d.serialNumber === ovrDeviceId);
      if (ovrDevice && !result.ovrDevices.find((d) => d.serialNumber === ovrDeviceId))
        result.ovrDevices.push(ovrDevice);
      else {
        const lighthouseDeviceId = this.getLighthouseIdForKnownDevice(device);
        const lighthouseDevice = lighthouseDevices.find((d) => d.id === lighthouseDeviceId);
        if (lighthouseDevice && !result.lighthouseDevices.find((d) => d.id === lighthouseDeviceId))
          result.lighthouseDevices.push(lighthouseDevice);
      }
    }

    return result;
  }

  private listenForOpenVRDevices() {
    this.openvr.devices
      .pipe(
        map((devices) => ({
          devices,
          deviceIds: devices.map((d) => this.getIdForOpenVRDevice(d)),
        })),
        // Update any already known devices that have received a different default name
        tap(({ devices, deviceIds }) => {
          devices.forEach((device, deviceIndex) => {
            const deviceId = deviceIds[deviceIndex];
            const knownDevice = this.getKnownDeviceById(deviceId);
            const defaultName = this.determineDefaultNameForOVRDevice(device);
            if (knownDevice?.defaultName !== defaultName) {
              this._data.next({
                ...this._data.value,
                knownDevices: this._data.value.knownDevices.map((d) =>
                  d.id === deviceId ? { ...d, defaultName } : d
                ),
              });
            }
          });
        }),
        distinctUntilChanged((a, b) => isEqual(a.deviceIds, b.deviceIds))
      )
      .subscribe(({ devices, deviceIds }) => {
        // Set all devices as observed, and remove any devices that are no longer observed
        const observedDeviceIds = [
          ...this._observedDevices.value.filter((id) => !id.startsWith('OVR_')),
          ...deviceIds,
        ].sort();
        if (!isEqual(observedDeviceIds, this._observedDevices.value)) {
          this._observedDevices.next(observedDeviceIds);
        }
        // Construct new known devices for any new devices
        const _devices = devices
          .map((d) => ({
            id: this.getIdForOpenVRDevice(d),
            device: d,
          }))
          .filter(({ id }) => !this.getKnownDeviceById(id))
          .map(({ id, device }) => {
            const deviceType: DMDeviceType | null = (() => {
              switch (device.class) {
                case 'HMD':
                  return 'HMD';
                case 'Controller':
                  return 'CONTROLLER';
                case 'GenericTracker':
                  return 'TRACKER';
                default:
                  return null;
              }
            })();
            if (!deviceType) return null;
            const defaultName = this.determineDefaultNameForOVRDevice(device);
            return {
              id,
              typeName: device.modelNumber,
              defaultName,
              deviceType,
              lastSeen: Date.now(),
              tagIds: [],
            } as DMKnownDevice;
          })
          .filter(Boolean) as DMKnownDevice[];
        // Add any new known devices
        if (_devices.length > 0) {
          this._data.next({
            ...this._data.value,
            knownDevices: [...this._data.value.knownDevices, ..._devices],
          });
        }
      });
  }

  private determineDefaultNameForOVRDevice(device: OVRDevice): string {
    return device.serialNumber ?? 'Unknown Device';
  }

  private listenForLighthouseDevices() {
    this.lighthouse.devices
      .pipe(
        map((devices) => ({
          devices,
          deviceIds: devices.map((d) => this.getIdForLighthouseDevice(d)),
        })),
        distinctUntilChanged((a, b) => isEqual(a, b))
      )
      .subscribe(({ devices, deviceIds }) => {
        // Set all devices as observed, and remove any devices that are no longer observed
        const observedDeviceIds = [
          ...this._observedDevices.value.filter((id) => !id.startsWith('LH_')),
          ...deviceIds,
        ].sort();
        if (!isEqual(observedDeviceIds, this._observedDevices.value)) {
          this._observedDevices.next(observedDeviceIds);
        }
        // Construct new known devices for any new devices
        const knownDevices = [...this._data.value.knownDevices];
        let updated = false;
        devices.forEach((d, index) => {
          const id = deviceIds[index];
          const knownDevice = knownDevices.find((d) => d.id === id);
          if (knownDevice && knownDevice.defaultName !== d.deviceName) {
            knownDevice.defaultName = d.deviceName;
            updated = true;
          } else if (!knownDevice) {
            let typeName = 'Lighthouse';
            switch (d.deviceType) {
              case 'lighthouseV1':
                typeName = 'Lighthouse V1';
                break;
              case 'lighthouseV2':
                typeName = 'Lighthouse V2';
                break;
            }
            knownDevices.push({
              id,
              typeName,
              defaultName: d.deviceName,
              deviceType: 'LIGHTHOUSE',
              lastSeen: Date.now(),
              tagIds: [],
            });
            updated = true;
          }
        });
        if (updated) {
          this._data.next({
            ...this._data.value,
            knownDevices,
          });
        }
      });
  }

  public getIdForOpenVRDevice(device: OVRDevice): string {
    return `OVR_${device.class}_${device.serialNumber}`;
  }

  public getIdForLighthouseDevice(device: LighthouseDevice): string {
    return `LH_${device.deviceType}_${device.id}`;
  }

  public getOpenVRIdForKnownDevice(device: DMKnownDevice): string | null {
    if (!device.id.startsWith('OVR_')) return null;
    return device.id.split('_')[2];
  }

  public getLighthouseIdForKnownDevice(device: DMKnownDevice): string | null {
    if (!device.id.startsWith('LH_')) return null;
    return device.id.split('_')[2];
  }

  private async loadData() {
    let data: DeviceManagerData | undefined = await SETTINGS_STORE.get<DeviceManagerData>(
      SETTINGS_KEY_DEVICE_MANAGER
    );
    data = data ? migrateDeviceManagerData(data) : this._data.value;
    this._data.next(data);
    await this.saveData();
  }

  private async saveData() {
    await SETTINGS_STORE.set(SETTINGS_KEY_DEVICE_MANAGER, this._data.value);
    await SETTINGS_STORE.save();
  }
}
