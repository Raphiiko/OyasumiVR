import { Injectable } from '@angular/core';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import {
  BehaviorSubject,
  combineLatest,
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
  shareReplay,
  take,
} from 'rxjs';
import { LighthouseDevice, LighthouseDevicePowerState } from '../models/lighthouse-device';
import { AppSettingsService } from './app-settings.service';
import { pRetry } from '../utils/promise-utils';

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
  v1Timeout: number | null;
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
  private v1Identifiers: { [id: string]: string } = {};

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
      this.v1Identifiers = settings.v1LighthouseIdentifiers;
      this.ignoredDevices = settings.ignoredLighthouses;
    });
    // Respond to lighthouse power control being turned on or off
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
        } else {
          this._devices.next([]);
          await invoke('lighthouse_reset');
        }
      });
    // Continuously scan for new lighthouses
    combineLatest([
      this._scanning.pipe(distinctUntilChanged()),
      this._status.pipe(distinctUntilChanged()),
      this.appSettings.settings.pipe(
        map((settings) => settings.lighthousePowerControl),
        distinctUntilChanged()
      ),
    ])
      .pipe(
        map(
          ([scanning, status, lighthousePowerControl]) =>
            !scanning && status === 'ready' && lighthousePowerControl
        ),
        debounceTime(1000),
        distinctUntilChanged(),
        filter(Boolean)
      )
      .subscribe(() => {
        invoke('lighthouse_start_scan', { duration: DEFAULT_SCAN_DURATION });
      });
  }

  public async setPowerState(
    device: LighthouseDevice,
    powerState: LighthouseDevicePowerState,
    force = false
  ) {
    // If the device is a V1 and we don't have the identifier, don't send the command
    let v1Identifier = undefined;
    if (device.deviceType === 'lighthouseV1') {
      if (!this.v1Identifiers[device.id]) {
        return;
      }
      v1Identifier = parseInt(this.v1Identifiers[device.id], 16);
    }
    // Handle force flag
    if (!force) {
      device.transitioningToPowerState = ['on', 'sleep', 'standby'].includes(powerState)
        ? powerState
        : undefined;
      this._devices.next(this._devices.value);
    }
    // Set the power state
    await pRetry(
      () =>
        invoke('lighthouse_set_device_power_state', {
          deviceId: device.id,
          powerState,
          v1Identifier,
        }),
      3,
      500
    );
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
    devices[index].v1Timeout = event.v1Timeout;
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

  public async ignoreDevice(device: LighthouseDevice, ignore: boolean) {
    const settings = await firstValueFrom(this.appSettings.settings);
    const ignoredLighthouses = structuredClone(settings.ignoredLighthouses);
    if (ignore && !ignoredLighthouses.includes(device.id)) ignoredLighthouses.push(device.id);
    else if (!ignore && ignoredLighthouses.includes(device.id))
      ignoredLighthouses.splice(ignoredLighthouses.indexOf(device.id), 1);
    this.appSettings.updateSettings({
      ignoredLighthouses,
    });
  }

  public isDeviceIgnored(device: LighthouseDevice) {
    return this.ignoredDevices.includes(device.id);
  }

  public testV1LighthouseIdentifier(
    device: LighthouseDevice,
    identifier: string
  ): Observable<number | 'SUCCESS' | 'INVALID' | 'ERROR'> {
    const steps = 7;
    let step = 0;
    return new Observable<number | 'SUCCESS' | 'INVALID' | 'ERROR'>((subscriber) => {
      (async () => {
        const writeTimeoutValue = (timeout: number, retries = 2, retryDelay = 1000) => {
          return pRetry(
            () =>
              invoke('lighthouse_set_device_power_state', {
                deviceId: device.id,
                v1Identifier: timeout === 0 ? undefined : parseInt(identifier, 16),
                v1Timeout: timeout,
                powerState: timeout === 0 ? 'on' : 'sleep',
              }),
            retries,
            retryDelay
          );
        };
        const waitForTimeoutValue = async (value: number, timeout = 10000) => {
          return firstValueFrom(
            merge(
              interval(100).pipe(
                filter(() =>
                  this._devices.value.some((d) => d.id === device.id && d.v1Timeout === value)
                ),
                map(() => true)
              ),
              of(false).pipe(delay(timeout))
            ).pipe(take(1))
          );
        };

        try {
          // Try first value
          subscriber.next(++step / steps);
          await writeTimeoutValue(42069);
          subscriber.next(++step / steps);
          if (!(await waitForTimeoutValue(42069))) {
            subscriber.next('INVALID');
            return;
          }
          // Try second value
          subscriber.next(++step / steps);
          await writeTimeoutValue(1337);
          subscriber.next(++step / steps);
          if (!(await waitForTimeoutValue(1337))) {
            subscriber.next('INVALID');
            return;
          }
          // Try resetting the timeout value
          subscriber.next(++step / steps);
          await writeTimeoutValue(0);
          subscriber.next(++step / steps);
          if (!(await waitForTimeoutValue(0))) {
            subscriber.next('INVALID');
            return;
          }
          // Success!
          subscriber.next('SUCCESS');
        } catch (e) {
          subscriber.next('ERROR');
        } finally {
          subscriber.complete();
        }
      })();
    }).pipe(shareReplay(1));
  }

  public deviceNeedsIdentifier(device: LighthouseDevice) {
    return device.deviceType === 'lighthouseV1' && !this.v1Identifiers[device.id];
  }
}
