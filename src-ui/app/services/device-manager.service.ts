import { Injectable } from '@angular/core';
import {
    asyncScheduler,
    BehaviorSubject,
    distinctUntilChanged,
    map,
    switchMap,
    throttleTime,
} from 'rxjs';
import {
    DEVICE_MANAGER_DATA_DEFAULT,
    DeviceManagerData,
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

@Injectable({
    providedIn: 'root',
})
export class DeviceManagerService {
    private _data = new BehaviorSubject<DeviceManagerData>(DEVICE_MANAGER_DATA_DEFAULT);
    private _activeDevices = new BehaviorSubject<string[]>([]);

    public readonly activeDevices = this._activeDevices.asObservable();
    public readonly knownDevices = this._data.pipe(map((data) => data.knownDevices));
    public readonly tags = this._data.pipe(map((data) => data.tags));

    constructor(
        private openvr: OpenVRService,
        private lighthouse: LighthouseService
    ) { }

    async init() {
        await this.loadData();
        this.listenForOpenVRDevices();
        this.listenForLighthouseDevices();
        this._data
            .pipe(
                throttleTime(2000, asyncScheduler, { leading: true, trailing: true }),
                switchMap(() => this.saveData()),
            )
            .subscribe();
    }

    public getKnownDeviceById(id: string) {
        return this._data.value.knownDevices.find((device) => device.id === id);
    }

    public getTagById(id: string) {
        return this._data.value.tags.find((tag) => tag.id === id);
    }

    public getTagsForKnownDevice(device: DMKnownDevice) {
        return this._data.value.tags.filter((tag) => device.tagIds.includes(tag.id));
    }

    public addTagToKnownDevice(device: DMKnownDevice, tag: DMDeviceTag) {
        this._data.next({
            ...this._data.value,
            knownDevices: this._data.value.knownDevices.map((d) =>
                d.id === device.id ? { ...d, tagIds: uniq([...d.tagIds, tag.id]) } : d
            ),
        });
    }

    public removeTagFromKnownDevice(device: DMKnownDevice, tag: DMDeviceTag) {
        this._data.next({
            ...this._data.value,
            knownDevices: this._data.value.knownDevices.map((d) =>
                d.id === device.id ? { ...d, tagIds: d.tagIds.filter((id) => id !== tag.id) } : d
            ),
        });
    }

    public forgetKnownDevice(device: DMKnownDevice) {
        this._data.next({
            ...this._data.value,
            knownDevices: this._data.value.knownDevices.filter((d) => d.id !== device.id),
        });
    }

    public setNicknameForKnownDevice(device: DMKnownDevice, nickname?: string) {
        if (nickname) nickname = nickname.trim();
        if (!nickname) nickname = undefined;
        const knownDevice = structuredClone(
            this._data.value.knownDevices.find((d) => d.id === device.id)
        );
        if (!knownDevice) return;
        if (nickname) knownDevice.nickname = nickname;
        else knownDevice.nickname = undefined;
        this._data.next({
            ...this._data.value,
            knownDevices: this._data.value.knownDevices.map((d) =>
                d.id === device.id ? knownDevice : d
            ),
        });
    }

    private listenForOpenVRDevices() {
        this.openvr.devices
            .pipe(
                map((devices) => ({
                    devices,
                    deviceIds: devices.map((d) => this.getIdForOpenVRDevice(d)),
                })),
                distinctUntilChanged((a, b) => isEqual(a.deviceIds, b.deviceIds))
            )
            .subscribe(({ devices, deviceIds }) => {
                // Set all devices as active, and remove any devices that are no longer active
                const activeDeviceIds = [
                    ...this._activeDevices.value.filter((id) => !id.startsWith('OVR_')),
                    ...deviceIds,
                ].sort();
                if (!isEqual(activeDeviceIds, this._activeDevices.value)) {
                    this._activeDevices.next(activeDeviceIds);
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
                        return {
                            id,
                            defaultName: device.modelNumber ?? device.serialNumber,
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

    private listenForLighthouseDevices() {
        this.lighthouse.devices
            .pipe(
                map((devices) => ({
                    devices,
                    deviceIds: devices.map((d) => this.getIdForLighthouseDevice(d)),
                })),
                distinctUntilChanged((a, b) => isEqual(a.deviceIds, b.deviceIds))
            )
            .subscribe(({ devices, deviceIds }) => {
                // Set all devices as active, and remove any devices that are no longer active
                const activeDeviceIds = [
                    ...this._activeDevices.value.filter((id) => !id.startsWith('LH_')),
                    ...deviceIds,
                ].sort();
                if (!isEqual(activeDeviceIds, this._activeDevices.value)) {
                    this._activeDevices.next(activeDeviceIds);
                }
                // Construct new known devices for any new devices
                const _devices = devices
                    .map((d) => ({
                        id: this.getIdForLighthouseDevice(d),
                        device: d,
                    }))
                    .filter(({ id }) => !this.getKnownDeviceById(id))
                    .map(
                        ({ id, device }) =>
                            ({
                                id,
                                defaultName: device.deviceName,
                                deviceType: 'LIGHTHOUSE',
                                lastSeen: Date.now(),
                                tagIds: [],
                            }) as DMKnownDevice
                    );
                // Add any new known devices
                if (_devices.length > 0) {
                    this._data.next({
                        ...this._data.value,
                        knownDevices: [...this._data.value.knownDevices, ..._devices],
                    });
                }
            });
    }

    private getIdForOpenVRDevice(device: OVRDevice): string {
        return `OVR_${device.class}_${device.serialNumber}`;
    }

    private getIdForLighthouseDevice(device: LighthouseDevice): string {
        return `LH_${device.deviceType}_${device.id}`;
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
