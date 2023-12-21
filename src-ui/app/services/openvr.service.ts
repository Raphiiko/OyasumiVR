import { ApplicationRef, Injectable } from '@angular/core';
import { listen } from '@tauri-apps/api/event';
import { DeviceUpdateEvent } from '../models/events';
import { invoke } from '@tauri-apps/api/tauri';
import { OVRDevice, OVRDevicePose } from '../models/ovr-device';
import { BehaviorSubject, firstValueFrom, Observable } from 'rxjs';
import { cloneDeep, orderBy } from 'lodash';
import { AppSettingsService } from './app-settings.service';
import { error } from 'tauri-plugin-log-api';

export type OpenVRStatus = 'INACTIVE' | 'INITIALIZING' | 'INITIALIZED';

@Injectable({
  providedIn: 'root',
})
export class OpenVRService {
  private _status: BehaviorSubject<OpenVRStatus> = new BehaviorSubject<OpenVRStatus>('INACTIVE');
  public status: Observable<OpenVRStatus> = this._status.asObservable();
  private _devices: BehaviorSubject<OVRDevice[]> = new BehaviorSubject<OVRDevice[]>([]);
  public devices: Observable<OVRDevice[]> = this._devices.asObservable();

  private _devicePoses: BehaviorSubject<{
    [trackingIndex: number]: OVRDevicePose;
  }> = new BehaviorSubject<{ [p: number]: OVRDevicePose }>({});
  public devicePoses: Observable<{ [trackingIndex: number]: OVRDevicePose }> =
    this._devicePoses.asObservable();
  private deviceNicknames: { [id: string]: string } = {};

  constructor(private appRef: ApplicationRef, private appSettings: AppSettingsService) {}

  async init() {
    this._status.next(await invoke<OpenVRStatus>('openvr_status'));
    this.appSettings.settings.subscribe((settings) => {
      this.deviceNicknames = settings.deviceNicknames;
    });
    await Promise.all([
      listen<DeviceUpdateEvent>('OVR_DEVICE_UPDATE', (event) =>
        this.onDeviceUpdate(event.payload.device)
      ),
      listen<OpenVRStatus>('OVR_STATUS_UPDATE', (event) => this.onStatusUpdate(event.payload)),
      listen<any>('OVR_POSE_UPDATE', (event) => {
        const poses = cloneDeep(this._devicePoses.value);
        const {
          index,
          quaternion,
          position,
        }: {
          index: number;
          quaternion: [number, number, number, number];
          position: [number, number, number];
        } = event.payload;
        poses[index] = { quaternion, position };
        this._devicePoses.next(poses);
        this.appRef.tick();
      }),
    ]);
  }

  public onDeviceUpdate(device: OVRDevice) {
    device = Object.assign({}, device);
    if (device.isTurningOff === null || device.isTurningOff === undefined)
      device.isTurningOff =
        this._devices.value.find((d) => d.index === device.index)?.isTurningOff ?? false;
    if (!device.canPowerOff) device.isTurningOff = false;
    this._devices.next(
      orderBy(
        [device, ...this._devices.value.filter((d) => d.index !== device.index)],
        ['deviceIndex'],
        ['asc']
      )
    );
    this.appRef.tick();
  }

  public async setAnalogGain(analogGain: number): Promise<void> {
    if (analogGain !== null && analogGain !== undefined) {
      return invoke('openvr_set_analog_gain', { analogGain });
    } else {
      console.error('[OpenVR] Attempted to set analogGain to null or undefined', analogGain);
      error('[OpenVR] Attempted to set analogGain to null or undefined');
    }
  }

  public getAnalogGain(): Promise<number> {
    return invoke<number>('openvr_get_analog_gain');
  }

  public setSupersampleScale(supersampleScale: number | null): Promise<void> {
    return invoke('openvr_set_supersample_scale', { supersampleScale });
  }

  public getSupersampleScale(): Promise<number | null> {
    return invoke<number | null>('openvr_get_supersample_scale');
  }

  public setFadeDistance(fadeDistance: number): Promise<void> {
    return invoke('openvr_set_fade_distance', { fadeDistance });
  }

  public getFadeDistance(): Promise<number> {
    return invoke<number>('openvr_get_fade_distance');
  }

  public async isDashboardVisible(): Promise<boolean> {
    return invoke<boolean>('openvr_is_dashboard_visible');
  }

  private onStatusUpdate(status: OpenVRStatus) {
    this._status.next(status);
    switch (status) {
      case 'INACTIVE':
      case 'INITIALIZING':
        this._devices.next([]);
        this._devicePoses.next({});
        break;
      case 'INITIALIZED':
        break;
    }
  }

  private async getDevices(): Promise<Array<OVRDevice>> {
    // Get devices
    let devices = await invoke<OVRDevice[]>('openvr_get_devices');
    // Carry over current local state
    devices = devices.map((device) => {
      device.isTurningOff =
        this._devices.value.find((d) => d.index === device.index)?.isTurningOff ?? false;
      return device;
    });
    // Return newly fetched devices
    return devices;
  }

  public getDeviceNickname(device: OVRDevice): string | null {
    return this.deviceNicknames['OVRDEVICE_' + device.serialNumber] ?? null;
  }

  public async setDeviceNickname(device: OVRDevice, nickname: string) {
    const settings = await firstValueFrom(this.appSettings.settings);
    const deviceNicknames = cloneDeep(settings.deviceNicknames);
    nickname = nickname.trim();
    if (nickname) {
      deviceNicknames['OVRDEVICE_' + device.serialNumber] = nickname;
    } else {
      delete deviceNicknames['OVRDEVICE_' + device.serialNumber];
    }
    this.appSettings.updateSettings({
      deviceNicknames,
    });
  }
}
