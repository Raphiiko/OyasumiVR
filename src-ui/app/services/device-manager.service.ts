import { Injectable } from '@angular/core';
import {
  asyncScheduler,
  BehaviorSubject,
  combineLatest,
  distinctUntilChanged,
  firstValueFrom,
  map,
  Observable,
  skip,
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
    this._data
      .pipe(
        skip(1),
        throttleTime(2000, asyncScheduler, { leading: true, trailing: true }),
        switchMap(() => this.saveData())
      )
      .subscribe();
    this.listenForOpenVRDevices();
    this.listenForLighthouseDevices();
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

  public disableKnownDevice(device: DMKnownDevice, disabled: boolean): DMKnownDevice {
    const patchedDevice = structuredClone(
      this._data.value.knownDevices.find((d) => d.id === device.id)
    );
    if (!patchedDevice) return device;
    patchedDevice.disabled = disabled;
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

  /** Emits selection matches when device availability or membership changes. */
  public getDevicesForSelectionStream(selection: DeviceSelection): Observable<{
    lighthouseDevices: LighthouseDevice[];
    ovrDevices: OVRDevice[];
    knownDevices: DMKnownDevice[];
  }> {
    // watch live devices alongside saved tags and disabled flags
    return combineLatest([this.openvr.devices, this.lighthouse.devices, this._data]).pipe(
      // ignore telemetry, nicknames, and tag appearance changes
      distinctUntilChanged(isEqual, ([ovrDevices, lighthouseDevices, data]) => [
        // compare openvr identities, including devices replacing reused indices
        ovrDevices.map(({ index, serialNumber, class: deviceClass }) => [
          index,
          serialNumber,
          deviceClass,
        ]),
        // compare available base station identities
        lighthouseDevices.map((device) => device.id),
        // compare saved fields that determine selection membership
        data.knownDevices.map(({ id, deviceType, tagIds, disabled }) => ({
          id,
          deviceType,
          tagIds,
          disabled,
        })),
      ]),
      // emit matching devices from these same input snapshots
      map(([ovrDevices, lighthouseDevices, data]) =>
        this.resolveSelection(selection, ovrDevices, lighthouseDevices, data.knownDevices)
      )
    );
  }

  /** Returns one selection snapshot without retaining a subscription. */
  public async getDevicesForSelection(selection: DeviceSelection): Promise<{
    lighthouseDevices: LighthouseDevice[];
    ovrDevices: OVRDevice[];
    knownDevices: DMKnownDevice[];
  }> {
    return firstValueFrom(this.getDevicesForSelectionStream(selection));
  }

  private resolveSelection(
    selection: DeviceSelection,
    openvrDevices: OVRDevice[],
    lighthouseDevices: LighthouseDevice[],
    knownDevices: DMKnownDevice[]
  ) {
    const result: {
      lighthouseDevices: LighthouseDevice[];
      ovrDevices: OVRDevice[];
      knownDevices: DMKnownDevice[];
    } = {
      lighthouseDevices: [],
      ovrDevices: [],
      knownDevices: [],
    };

    // include enabled devices matching any selected type
    for (const type of selection.types) {
      result.knownDevices.push(...knownDevices.filter((d) => d.deviceType === type && !d.disabled));
      switch (type) {
        case 'HMD':
        case 'CONTROLLER':
        case 'TRACKER': {
          const devices = openvrDevices;
          switch (type) {
            case 'HMD':
              result.ovrDevices.push(
                ...devices
                  .filter((d) => d.class === 'HMD')
                  .filter((d) => {
                    const knownDevice = knownDevices.find(
                      (known) => known.id === this.getIdForOpenVRDevice(d)
                    );
                    return !knownDevice?.disabled;
                  })
              );
              break;
            case 'CONTROLLER':
              result.ovrDevices.push(
                ...devices
                  .filter((d) => d.class === 'Controller')
                  .filter((d) => {
                    const knownDevice = knownDevices.find(
                      (known) => known.id === this.getIdForOpenVRDevice(d)
                    );
                    return !knownDevice?.disabled;
                  })
              );
              break;
            case 'TRACKER':
              result.ovrDevices.push(
                ...devices
                  .filter((d) => d.class === 'GenericTracker')
                  .filter((d) => {
                    const knownDevice = knownDevices.find(
                      (known) => known.id === this.getIdForOpenVRDevice(d)
                    );
                    return !knownDevice?.disabled;
                  })
              );
              break;
          }
          break;
        }
        case 'LIGHTHOUSE': {
          lighthouseDevices.forEach((d) => {
            const knownDevice = knownDevices.find(
              (known) => known.id === this.getIdForLighthouseDevice(d)
            );
            if (!knownDevice?.disabled) result.lighthouseDevices.push(d);
          });
          break;
        }
        default:
          error(
            `[DeviceManagerService] getDevicesForSelection attempted to get devices for unknown device type (${type})`
          );
          break;
      }
    }

    // add enabled tagged devices without duplicating earlier matches
    for (const tagId of selection.tagIds) {
      const devices = knownDevices.filter((d) => d.tagIds.includes(tagId) && !d.disabled);
      for (const device of devices) {
        if (!result.knownDevices.find((d) => d.id === device.id)) {
          result.knownDevices.push(device);
        }
        // match the saved device to its live counterpart
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

    // add explicitly selected devices, excluding disabled or unknown entries
    for (const deviceId of selection.devices) {
      const device = knownDevices.find((known) => known.id === deviceId);
      if (!device || device.disabled) continue;
      if (!result.knownDevices.find((d) => d.id === device.id)) {
        result.knownDevices.push(device);
      }
      // match the saved device to its live counterpart
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
              disabled: false,
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
              disabled: false,
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
    const data: DeviceManagerData | undefined = await SETTINGS_STORE.get<DeviceManagerData>(
      SETTINGS_KEY_DEVICE_MANAGER
    );
    if (data) this._data.next(data);
  }

  private async saveData() {
    await SETTINGS_STORE.set(SETTINGS_KEY_DEVICE_MANAGER, this._data.value);
  }
}
