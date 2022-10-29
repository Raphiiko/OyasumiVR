import { Injectable } from '@angular/core';
import { invoke } from '@tauri-apps/api/tauri';
import { NVMLDevice } from '../models/nvml-device';
import { BehaviorSubject, filter, Observable } from 'rxjs';
import { ElevatedSidecarService } from './elevated-sidecar.service';
import { error, info } from 'tauri-plugin-log-api';

export type NVMLStatus =
  | 'ELEVATION_SIDECAR_INACTIVE'
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

  constructor(private sidecar: ElevatedSidecarService) {}

  async init() {
    this.sidecar.sidecarRunning.pipe(filter((running) => running)).subscribe(() => {
      this.handleNVMLStatusUpdate();
    });
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

  public async setPowerLimit(uuid: string, limit: number): Promise<boolean> {
    limit = Math.floor(limit);
    const success = await invoke<boolean>('nvml_set_power_management_limit', { uuid, limit });
    if (success) {
      this._devices.next(await this.getDevices());
      info(`[NVML] Set gpu power limit (uuid=${uuid}, powerLimit:${limit})`);
    } else {
      error(`[NVML] Could not set gpu power limit (uuid=${uuid}, powerLimit:${limit})`);
    }
    return success;
  }

  private getNVMLStatus(): Promise<NVMLStatus> {
    return invoke<NVMLStatus>('nvml_status');
  }
}
