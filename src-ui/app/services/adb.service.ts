import { Injectable } from '@angular/core';
import { invoke } from '@tauri-apps/api/core';
import { ADBDevice, ADBDeviceState, ADBServerStatus } from '../models/adb';
import {
  BehaviorSubject,
  combineLatest,
  debounceTime,
  delay,
  distinctUntilChanged,
  interval,
  map,
  Observable,
  of,
  startWith,
  switchMap,
  tap,
} from 'rxjs';
import { isEqual } from 'lodash';
import { debug, error, info } from '@tauri-apps/plugin-log';
import { OpenVRService } from './openvr.service';
import { AppSettingsService } from './app-settings.service';

// Maps the 'model' field of the ADBDevice to all known possible modelNumbers of the matching OVRDevice
const ADB_TO_OVR_MODEL_MAP: Record<string, string[]> = {
  Quest_Pro: ['Meta Quest Pro', 'Oculus Quest Pro'],
};

@Injectable({
  providedIn: 'root',
})
export class ADBService {
  private readonly _serverStatus = new BehaviorSubject<ADBServerStatus | null>(null);
  public readonly serverStatus = this._serverStatus.asObservable();

  private readonly _targetModel = new BehaviorSubject<string | null>(null);
  public readonly targetModel = this._targetModel.asObservable();

  private readonly _activeDevice = new BehaviorSubject<ADBDevice | null>(null);
  public readonly activeDevice = this._activeDevice.asObservable();

  // Match serialNumber of OVR device to last seen host and port of matching ADB device
  private wirelessDeviceStorage = new BehaviorSubject<
    Record<string, { host: string; port: number }>
  >({});

  // Returns the last known adb host and port for the currently active HMD
  public readonly wirelessDeviceTarget: Observable<{ host: string; port: number } | null>;

  constructor(
    private openvr: OpenVRService,
    private appSettings: AppSettingsService
  ) {
    this.wirelessDeviceTarget = combineLatest([
      this.wirelessDeviceStorage,
      this.openvr.devices.pipe(
        map((devices) => devices.find((d) => d.class === 'HMD')?.serialNumber ?? null)
      ),
    ]).pipe(
      map(
        ([wirelessDeviceStorage, serialNumber]) => wirelessDeviceStorage[serialNumber ?? ''] ?? null
      )
    );
  }

  async init() {
    // Subscribe to app settings to update wireless device storage
    this.appSettings.settings
      .pipe(
        map((settings) => settings.adbWirelessDeviceMap),
        distinctUntilChanged((a, b) => isEqual(a, b))
      )
      .subscribe((adbWirelessDeviceMap) => {
        this.wirelessDeviceStorage.next(adbWirelessDeviceMap);
      });
    // Poll for the active HMD
    this.pollDeviceForActiveHMD();
    // Automatically reconnect to previously seen wireless devices
    this.reconnectWirelessDevices();
  }

  private async pollDeviceForActiveHMD() {
    this.openvr.devices
      .pipe(
        // Find model number of active HMD
        map((devices) => devices.find((d) => d.class === 'HMD')),
        distinctUntilChanged((a, b) => isEqual(a?.modelNumber, b?.modelNumber)),
        // Find target model number for active HMD
        map((ovrDevice) => {
          if (!ovrDevice) return { ovrDevice, targetModel: null };
          const targetModel =
            Object.entries(ADB_TO_OVR_MODEL_MAP).find(([_, ovrDeviceModels]) =>
              ovrDeviceModels.includes(ovrDevice?.modelNumber ?? '')
            )?.[0] ?? null;
          return { targetModel, ovrDevice };
        }),
        distinctUntilChanged(),
        tap(({ targetModel }) => {
          if (targetModel)
            info(
              `[ADBService] Determined target model for currently connected HMD: ${targetModel}`
            );
          this._targetModel.next(targetModel);
        }),
        // Only poll ADB server status if we have a target model
        switchMap(({ ovrDevice, targetModel }) => {
          // Poll ADB server status
          return interval(5000).pipe(
            startWith(null),
            switchMap(async () => {
              const status = await this.adbGetServerStatus();
              if (!isEqual(this._serverStatus.value, status)) {
                info('[ADBService] ADB Server: ' + JSON.stringify(status));
                this._serverStatus.next(status);
              }
              return {
                ovrDevice,
                targetModel,
                serverStatus: status,
              };
            })
          );
        }),
        // Poll ADB device for target model
        switchMap(async ({ ovrDevice, targetModel, serverStatus }) => {
          // No need to poll the adb device if we don't have an active ADB device model or the server is not running
          if (!ovrDevice || !targetModel || serverStatus?.status !== 'running') return of(null);
          // Poll ADB devices
          let adbDevices: ADBDevice[];
          try {
            adbDevices = await this.adbGetDevices();
          } catch (e) {
            if (e !== 'ADB_SERVER_NOT_RUNNING') {
              error('[ADBService] Failed to get ADB devices: ' + e);
            }
            return null;
          }
          // Find ADB device for target model
          const adbDevice = adbDevices.find((d) => d.model === targetModel) ?? null;
          // Update active device if it has changed
          if (!isEqual(this._activeDevice.value, adbDevice)) {
            if (adbDevice) {
              info(`[ADBService] Found matching device: ${adbDevice.identifier}`);
            } else {
              info(`[ADBService] device lost`);
            }
            this._activeDevice.next(adbDevice ?? null);
            // If the ADB device is a wireless device, update the wireless device storage if needed
            if (
              adbDevice?.identifier.match(
                /^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}[:][0-9]{1,5}$/
              )
            ) {
              const [host, portString] = adbDevice.identifier.split(':');
              const port = parseInt(portString);
              if (
                !isEqual(this.wirelessDeviceStorage.value[ovrDevice.serialNumber ?? ''], {
                  host,
                  port,
                })
              ) {
                info(
                  `[ADBService] Determined wireless target for adb device (${ovrDevice.serialNumber}): ${host}:${port}`
                );
                this.appSettings.updateSettings({
                  adbWirelessDeviceMap: {
                    ...this.wirelessDeviceStorage.value,
                    [ovrDevice.serialNumber ?? '']: { host, port },
                  },
                });
              }
            }
          }
          return adbDevice;
        })
      )
      .subscribe();
  }

  private async reconnectWirelessDevices() {
    combineLatest([
      this.openvr.devices.pipe(
        map((devices) => devices.find((d) => d.class === 'HMD')),
        map((hmd) => hmd?.serialNumber ?? null),
        distinctUntilChanged()
      ),
      this._serverStatus,
      this._targetModel,
      this._activeDevice,
      this.wirelessDeviceStorage,
    ])
      .pipe(
        debounceTime(500),
        map(([hmdSerialNumber, serverStatus, targetModel, activeDevice, wirelessDeviceStorage]) => {
          // If the server is not running, we don't need to reconnect
          if (serverStatus?.status !== 'running') return null;
          // If we don't have a target model, we don't need to reconnect
          if (!targetModel) return null;
          // If we already have an active device, we might need to reconnect
          if (activeDevice) {
            switch (activeDevice.state) {
              // No need to reconnect
              case 'authorizing':
              case 'unauthorized':
              case 'connecting':
              case 'device':
              case 'host':
              case 'recovery':
              case 'sideload':
              case 'rescue':
              case 'noPerm':
              case 'bootloader':
                return null;
              // States of disconnected devices (we want to attempt reconnection)
              case 'offline':
              case 'noDevice':
              case 'detached':
            }
          }
          // If we don't have a record in the wireless device storage, we don't need to reconnect
          return wirelessDeviceStorage[hmdSerialNumber ?? ''] ?? null;
        }),
        // Wait 3 seconds before connecting the ADB device at a 5s interval
        switchMap((record) => {
          if (!record) return of(null);
          return interval(5000).pipe(
            startWith(null),
            delay(3000),
            map(() => record)
          );
        }),
        switchMap(async (record) => {
          if (!record) return;
          try {
            debug(
              `[ADBService] Attempting to connect to wireless device (${record.host}:${record.port})`
            );
            await this.adbConnectDevice(record.host, record.port);
          } catch (e) {
            debug('[ADBService] Failed to connect to wireless device: ' + e);
          }
        })
      )
      .subscribe();
  }

  // Rust interface
  // TODO: Make private once we don't need the developer modal anymore
  public async adbGetServerStatus(): Promise<ADBServerStatus> {
    return await invoke<ADBServerStatus>('adb_get_server_status');
  }

  public async adbGetDevices(): Promise<ADBDevice[]> {
    return await invoke<ADBDevice[]>('adb_get_devices');
  }

  public async adbGetDeviceStatus(id: string): Promise<ADBDeviceState> {
    return await invoke<ADBDeviceState>('adb_get_device_status', { id });
  }

  public async adbSetBrightness(id: string, brightness: number) {
    await invoke('adb_set_brightness', { id, brightness });
  }

  public async adbGetBrightness(id: string): Promise<number> {
    return await invoke<number>('adb_get_brightness', { id });
  }

  public async adbConnectDevice(host: string, port: number) {
    await invoke('adb_connect_device', { host, port });
  }
}
