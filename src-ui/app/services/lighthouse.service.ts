import { Injectable } from '@angular/core';
import { invoke } from '@tauri-apps/api';
import { listen } from '@tauri-apps/api/event';
import {
  BehaviorSubject,
  debounceTime,
  delay,
  distinctUntilChanged,
  filter,
  firstValueFrom,
  interval,
  map,
  merge,
  Observable,
  of,
  take,
} from 'rxjs';
import { LighthouseDevice, LighthouseDevicePowerState } from '../models/lighthouse-device';
import { AppSettingsService } from './app-settings.service';

const DEFAULT_SCAN_DURATION = 8;
export type LighthouseStatus = 'uninitialized' | 'noAdapter' | 'adapterError' | 'ready';

interface LighthouseScanningStatusChangedEvent {
  scanning: boolean;
}

interface LighthouseStatusChangedEvent {
  status: LighthouseStatus;
}

interface LighthouseDeviceDiscoveredEvent {
  device: LighthouseDevice;
}

interface LighthouseDevicePowerStateChangedEvent {
  deviceId: string;
  powerState: LighthouseDevicePowerState;
}

@Injectable({
  providedIn: 'root',
})
export class LighthouseService {
  private readonly _status: BehaviorSubject<LighthouseStatus> =
    new BehaviorSubject<LighthouseStatus>('uninitialized');
  public readonly status: Observable<LighthouseStatus> = this._status.asObservable();
  private readonly _scanning: BehaviorSubject<boolean> = new BehaviorSubject<boolean>(false);
  public readonly scanning: Observable<boolean> = this._scanning.asObservable();
  private readonly _devices: BehaviorSubject<LighthouseDevice[]> = new BehaviorSubject<
    LighthouseDevice[]
  >([]);
  public readonly devices: Observable<LighthouseDevice[]> = this._devices.asObservable();
  private deviceNicknames: { [id: string]: string } = {};
  private ignoredDevices: string[] = [];

  constructor(private appSettings: AppSettingsService) {}

  async init() {
    listen<LighthouseStatusChangedEvent>('LIGHTHOUSE_STATUS_CHANGED', (event) =>
      this.handleStatusChange(event.payload)
    );
    listen<LighthouseScanningStatusChangedEvent>('LIGHTHOUSE_SCANNING_STATUS_CHANGED', (event) =>
      this.handleScanningStatusChange(event.payload)
    );
    listen<LighthouseDeviceDiscoveredEvent>('LIGHTHOUSE_DEVICE_DISCOVERED', (event) =>
      this.handleDeviceDiscovered(event.payload)
    );
    listen<LighthouseDevicePowerStateChangedEvent>(
      'LIGHTHOUSE_DEVICE_POWER_STATE_CHANGED',
      (event) => this.handleDevicePowerStateChange(event.payload)
    );
    this.appSettings.settings.subscribe((settings) => {
      this.deviceNicknames = settings.deviceNicknames;
      this.ignoredDevices = settings.ignoredLighthouses;
    });
    this.appSettings.settings
      .pipe(
        debounceTime(100),
        map((settings) => settings.lighthousePowerControl),
        distinctUntilChanged()
      )
      .subscribe(async (lighthousePowerControl) => {
        if (lighthousePowerControl) {
          const status = await invoke<LighthouseStatus>('lighthouse_get_status');
          this._status.next(status);
          this._devices.next(await invoke<LighthouseDevice[]>('lighthouse_get_devices'));
          if (status === 'ready') {
            await invoke('lighthouse_start_scan', { duration: DEFAULT_SCAN_DURATION });
          }
        } else {
          this._devices.next([]);
          await invoke('lighthouse_reset');
        }
      });
  }

  async scan() {
    if (this._scanning.value) return;
    this._scanning.next(true);
    await invoke('lighthouse_start_scan', { duration: DEFAULT_SCAN_DURATION });
  }

  public async setPowerState(
    device: LighthouseDevice,
    powerState: LighthouseDevicePowerState,
    force = false
  ) {
    if (!force) {
      device.transitioningToPowerState = ['on', 'sleep', 'standby'].includes(powerState)
        ? powerState
        : undefined;
      this._devices.next(this._devices.value);
    }
    invoke('lighthouse_set_device_power_state', { deviceId: device.id, powerState });
    // Wait for state to change (timeout after 10 seconds)
    await firstValueFrom(
      merge(
        interval(100).pipe(
          delay(500), // Wait 500ms before checking, to make sure the feedback in the UI lasts long enough
          filter(() =>
            this._devices.value.some((d) => d.id === device.id && d.powerState === powerState)
          )
        ),
        of(null).pipe(delay(10000))
      ).pipe(take(1))
    );
    device.transitioningToPowerState = undefined;
    this._devices.next(this._devices.value);
  }

  private async handleStatusChange(event: LighthouseStatusChangedEvent) {
    if (this._status.value !== event.status) {
      this._status.next(event.status);
      if ((await firstValueFrom(this.appSettings.settings)).lighthousePowerControl) {
        if (event.status === 'ready') {
          await invoke('lighthouse_start_scan', { duration: DEFAULT_SCAN_DURATION });
        }
      }
    }
  }

  private async handleScanningStatusChange(event: LighthouseScanningStatusChangedEvent) {
    if (this._scanning.value !== event.scanning) this._scanning.next(event.scanning);
  }

  private async handleDeviceDiscovered(event: LighthouseDeviceDiscoveredEvent) {
    const device = event.device;
    const devices = this._devices.value;
    if (!devices.some((d) => d.id === device.id)) {
      devices.push(device);
      this._devices.next(devices);
    } else {
      const index = devices.findIndex((d) => d.id === device.id);
      Object.assign(devices[index], device);
      this._devices.next(devices);
    }
  }

  private async handleDevicePowerStateChange(event: LighthouseDevicePowerStateChangedEvent) {
    let devices = this._devices.value;
    let index = devices.findIndex((d) => d.id === event.deviceId);
    if (index === -1) {
      devices = await this.updateDevices();
      index = devices.findIndex((d) => d.id === event.deviceId);
      if (index === -1) return;
    }
    devices[index].powerState = event.powerState;
    this._devices.next(devices);
  }

  private async updateDevices() {
    const devices = this._devices.value;
    (await invoke<LighthouseDevice[]>('lighthouse_get_devices')).forEach((d) => {
      if (!devices.some((d2) => d2.id === d.id)) devices.push(d);
      else {
        const index = devices.findIndex((d2) => d2.id === d.id);
        Object.assign(devices[index], d);
      }
    });
    return devices;
  }

  public getDeviceNickname(device: LighthouseDevice): string | null {
    return this.deviceNicknames['LIGHTHOUSE_' + device.id] ?? null;
  }

  public async setDeviceNickname(device: LighthouseDevice, nickname: string) {
    const settings = await firstValueFrom(this.appSettings.settings);
    const deviceNicknames = structuredClone(settings.deviceNicknames);
    nickname = nickname.trim();
    if (nickname) {
      deviceNicknames['LIGHTHOUSE_' + device.id] = nickname;
    } else {
      delete deviceNicknames['LIGHTHOUSE_' + device.id];
    }
    this.appSettings.updateSettings({
      deviceNicknames,
    });
  }

  async ignoreDevice(device: LighthouseDevice, ignore: boolean) {
    const settings = await firstValueFrom(this.appSettings.settings);
    const ignoredLighthouses = structuredClone(settings.ignoredLighthouses);
    if (ignore && !ignoredLighthouses.includes(device.id)) ignoredLighthouses.push(device.id);
    else if (!ignore && ignoredLighthouses.includes(device.id))
      ignoredLighthouses.splice(ignoredLighthouses.indexOf(device.id), 1);
    this.appSettings.updateSettings({
      ignoredLighthouses,
    });
  }

  isDeviceIgnored(device: LighthouseDevice) {
    return this.ignoredDevices.includes(device.id);
  }
}
