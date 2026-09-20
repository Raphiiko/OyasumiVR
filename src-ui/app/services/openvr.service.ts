import { ApplicationRef, Injectable } from '@angular/core';
import { listen } from '@tauri-apps/api/event';
import { DeviceUpdateEvent } from '../models/events';
import { invoke } from '@tauri-apps/api/core';
import { OVRDevice, OVRDevicePose } from '../models/ovr-device';
import {
  BehaviorSubject,
  distinctUntilChanged,
  filter,
  interval,
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
export type AutoLaunchSyncState = 'IDLE' | 'SYNCING' | 'ERROR';

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

  private _autoLaunchSyncState: BehaviorSubject<AutoLaunchSyncState> =
    new BehaviorSubject<AutoLaunchSyncState>('IDLE');
  public autoLaunchSyncState: Observable<AutoLaunchSyncState> =
    this._autoLaunchSyncState.asObservable();
  private autoLaunchQueue: Promise<unknown> = Promise.resolve();
  private autoLaunchSession = 0;
  private autoLaunchReconciled = false;

  constructor(
    private appRef: ApplicationRef,
    private appSettings: AppSettingsService,
    private telemetry: TelemetryService
  ) {}

  async init() {
    let statusReceived = false;
    let deviceSession = 0;
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
      listen<OpenVRStatus>('OVR_STATUS_UPDATE', (event) => {
        statusReceived = true;
        deviceSession++;
        this.onStatusUpdate(event.payload);
      }),
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
    // A status update sent while the listener above was still being registered is never delivered
    const status = await invoke<OpenVRStatus>('openvr_status');
    if (!statusReceived) this.onStatusUpdate(status);
    interval(2000).subscribe(() => this.syncApplicationAutoLaunchChanges());

    // restore cached devices missed before listener registration
    const snapshotSession = deviceSession;
    const devices = await invoke<OVRDevice[]>('openvr_get_devices');
    if (snapshotSession === deviceSession && this._status.value === 'INITIALIZED') {
      for (const device of devices) {
        if (!this._devices.value.some((current) => current.index === device.index)) {
          this.onDeviceUpdate(device);
        }
      }
    }

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
        ['index'],
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

  public setStartWithSteamVR(enabled: boolean): Promise<void> {
    if (this._status.value !== 'INITIALIZED') {
      this.storeStartWithSteamVR(enabled);
      return Promise.resolve();
    }
    return this.enqueueAutoLaunchOperation(async (session) => {
      this.storeStartWithSteamVR(enabled);
      if (session !== this.autoLaunchSession || this._status.value !== 'INITIALIZED') {
        return;
      }
      try {
        await this.writeApplicationAutoLaunch(enabled, session);
      } catch (cause) {
        if (session === this.autoLaunchSession && this._status.value === 'INITIALIZED')
          this.autoLaunchReconciled = false;
        throw cause;
      }
      if (session === this.autoLaunchSession && this._status.value === 'INITIALIZED') {
        this.autoLaunchReconciled = true;
        this._autoLaunchSyncState.next('IDLE');
      }
    });
  }

  public async isDashboardVisible(): Promise<boolean> {
    return invoke<boolean>('openvr_is_dashboard_visible');
  }

  private onStatusUpdate(status: OpenVRStatus) {
    this.autoLaunchSession++;
    this.autoLaunchReconciled = false;
    this._autoLaunchSyncState.next('IDLE');
    this._status.next(status);
    switch (status) {
      case 'INACTIVE':
      case 'INITIALIZING':
        this._devices.next([]);
        this._devicePoses.next({});
        break;
      case 'INITIALIZED':
        this.reconcileApplicationAutoLaunch();
        break;
    }
  }

  private reconcileApplicationAutoLaunch() {
    const session = this.autoLaunchSession;
    this.enqueueAutoLaunchOperation(async () => {
      if (session !== this.autoLaunchSession || this._status.value !== 'INITIALIZED') return;
      const settings = this.appSettings.settingsSync;
      let enabled: boolean;
      try {
        enabled = await invoke<boolean>('openvr_get_application_auto_launch');
      } catch (cause) {
        error(`[OpenVR] Could not read application auto-launch: ${cause}`);
        if (session === this.autoLaunchSession) this._autoLaunchSyncState.next('ERROR');
        return;
      }
      if (session !== this.autoLaunchSession || this._status.value !== 'INITIALIZED') return;
      if (!settings.startWithSteamVRPreferenceSet) {
        this.storeStartWithSteamVR(enabled);
      } else if (enabled !== settings.startWithSteamVR) {
        await this.writeApplicationAutoLaunch(settings.startWithSteamVR, session);
      }
      this.autoLaunchReconciled = true;
      this._autoLaunchSyncState.next('IDLE');
    }).catch(() => undefined);
  }

  private syncApplicationAutoLaunchChanges() {
    if (this._status.value !== 'INITIALIZED') return;
    if (!this.autoLaunchReconciled) {
      this.reconcileApplicationAutoLaunch();
      return;
    }
    const session = this.autoLaunchSession;
    this.enqueueAutoLaunchOperation(async () => {
      if (session !== this.autoLaunchSession || this._status.value !== 'INITIALIZED') return;
      let enabled: boolean;
      try {
        enabled = await invoke<boolean>('openvr_get_application_auto_launch');
      } catch (cause) {
        error(`[OpenVR] Could not read application auto-launch: ${cause}`);
        if (session === this.autoLaunchSession) this._autoLaunchSyncState.next('ERROR');
        return;
      }
      if (session !== this.autoLaunchSession || this._status.value !== 'INITIALIZED') return;
      if (enabled !== this.appSettings.settingsSync.startWithSteamVR) {
        this.appSettings.updateSettings({ startWithSteamVR: enabled });
      }
      this._autoLaunchSyncState.next('IDLE');
    }).catch(() => undefined);
  }

  private storeStartWithSteamVR(enabled: boolean) {
    this.appSettings.updateSettings({
      startWithSteamVR: enabled,
      startWithSteamVRPreferenceSet: true,
    });
  }

  private async writeApplicationAutoLaunch(enabled: boolean, session: number) {
    this._autoLaunchSyncState.next('SYNCING');
    try {
      await invoke('openvr_set_application_auto_launch', { enabled });
      const confirmed = await invoke<boolean>('openvr_get_application_auto_launch');
      if (confirmed !== enabled) throw new Error('AUTO_LAUNCH_WRITE_NOT_CONFIRMED');
    } catch (cause) {
      error(`[OpenVR] Could not set application auto-launch: ${cause}`);
      if (session === this.autoLaunchSession) this._autoLaunchSyncState.next('ERROR');
      throw cause;
    }
  }

  private enqueueAutoLaunchOperation<T>(work: (session: number) => Promise<T>): Promise<T> {
    const session = this.autoLaunchSession;
    const result = this.autoLaunchQueue.then(
      () => work(session),
      () => work(session)
    );
    this.autoLaunchQueue = result.catch(() => undefined);
    return result;
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
