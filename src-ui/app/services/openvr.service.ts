import { ApplicationRef, Injectable } from '@angular/core';
import { listen } from '@tauri-apps/api/event';
import { DeviceUpdateEvent } from '../models/events';
import { invoke } from '@tauri-apps/api/core';
import { OVRDevice, OVRDevicePose } from '../models/ovr-device';
import {
  BehaviorSubject,
  distinctUntilChanged,
  filter,
  map,
  Observable,
  skip,
  startWith,
} from 'rxjs';
import { orderBy } from 'lodash';
import { AppSettingsService } from './app-settings.service';
import { error, info } from '@tauri-apps/plugin-log';
import { TelemetryService } from './telemetry.service';

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

  constructor(
    private appRef: ApplicationRef,
    private appSettings: AppSettingsService,
    private telemetry: TelemetryService
  ) {}

  async init() {
    this._status.next(await invoke<OpenVRStatus>('openvr_status'));
    this.appSettings.settings
      .pipe(
        map((settings) => settings.openVrInitDelayFix),
        startWith(false),
        distinctUntilChanged(),
        skip(1)
      )
      .subscribe((fixEnabled) => {
        this.applyOpenVrInitDelayFix(fixEnabled);
        if (fixEnabled) info('[OpenVR] Applying OpenVR Initialization delay fix');
        else info('[OpenVR] Removing OpenVR initialization delay fix');
      });
    await Promise.all([
      listen<DeviceUpdateEvent>('OVR_DEVICE_UPDATE', (event) =>
        this.onDeviceUpdate(event.payload.device)
      ),
      listen<OpenVRStatus>('OVR_STATUS_UPDATE', (event) => this.onStatusUpdate(event.payload)),
      listen<any>('OVR_POSE_UPDATE', (event) => {
        const poses = structuredClone(this._devicePoses.value);
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

    this.handleTelemetry();
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
    if (typeof analogGain === 'number' && isFinite(analogGain)) {
      return invoke('openvr_set_analog_gain', { analogGain });
    } else {
      console.error('[OpenVR] Attempted to set analogGain to invalid value', analogGain);
      error('[OpenVR] Attempted to set analogGain to invalid value: ' + analogGain);
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

  private async applyOpenVrInitDelayFix(enabled: boolean) {
    await invoke('openvr_set_init_delay_fix', { enabled });
  }

  private handleTelemetry() {
    this._devices
      .pipe(
        map((devices) => devices.find((d) => d.class === 'HMD')),
        filter(Boolean),
        distinctUntilChanged()
      )
      .subscribe((hmdName) => {
        this.telemetry.trackThrottledEvent(
          'vr_hmd',
          {
            manufacturerName: hmdName.manufacturerName ?? 'Unknown',
            modelNumber: hmdName.modelNumber ?? 'Unknown',
            hmdName: `${hmdName.manufacturerName} ${hmdName.modelNumber}`,
          },
          1000 * 60 * 60 * 24,
          true
        );
      });
  }
}
