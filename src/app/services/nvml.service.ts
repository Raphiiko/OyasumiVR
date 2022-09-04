import { Injectable } from '@angular/core';
import { invoke } from '@tauri-apps/api/tauri';
import { NVMLDevice } from '../models/nvml-device';
import { listen } from '@tauri-apps/api/event';
import { DeviceUpdateEvent } from '../models/events';
import { BehaviorSubject, Observable } from 'rxjs';

export type NVMLStatus =
  | 'INITIALIZING'
  | 'INIT_COMPLETE'
  | 'DRIVER_NOT_LOADED'
  | 'NO_PERMISSION'
  | 'NVML_UNKNOWN_ERROR'
  | 'UNKNOWN_ERROR';

@Injectable({
  providedIn: 'root',
})
export class NVMLService {
  private _devices: BehaviorSubject<NVMLDevice[]> = new BehaviorSubject<NVMLDevice[]>([]);
  public devices: Observable<NVMLDevice[]> = this._devices.asObservable();
  private _status: BehaviorSubject<NVMLStatus> = new BehaviorSubject<NVMLStatus>('INITIALIZING');
  public status: Observable<NVMLStatus> = this._status.asObservable();

  constructor() {}

  async init() {
    await Promise.all([
      listen('NVML_INIT_COMPLETE', (event) => this.handleNVMLStatusUpdate()),
      listen('NVML_INIT_ERROR', (event) => this.handleNVMLStatusUpdate()),
      this.handleNVMLStatusUpdate(),
    ]);
  }

  private async handleNVMLStatusUpdate() {
    const status = await this.getNVMLStatus();
    if (status === this._status.value) return;
    this._status.next(status);
    if (status === 'INIT_COMPLETE') {
      this._devices.next(await this.getDevices());
    }
  }

  private getDevices(): Promise<Array<NVMLDevice>> {
    return invoke<NVMLDevice[]>('nvml_get_devices');
  }

  public async setPowerLimit(index: number, limit: number): Promise<boolean> {
    limit = Math.floor(limit);
    const success = await invoke<boolean>('nvml_set_power_management_limit', { index, limit });
    if (success) {
      this._devices.next(await this.getDevices());
    }
    return success;
  }

  private getNVMLStatus(): Promise<NVMLStatus> {
    return invoke<NVMLStatus>('nvml_status');
  }
}
