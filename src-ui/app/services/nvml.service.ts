import { Injectable } from '@angular/core';
import { invoke } from '@tauri-apps/api/core';
import { NvmlDevice as NvmlDevice } from '../models/nvml-device';
import { BehaviorSubject, delay, filter, interval, Observable, startWith, switchMap } from 'rxjs';
import { ElevatedSidecarService } from './elevated-sidecar.service';
import { error, info } from '@tauri-apps/plugin-log';

export type NvmlStatus =
  | 'Initializing'
  | 'InitComplete'
  | 'DriverNotLoaded'
  | 'LibLoadingError'
  | 'NoPermission'
  | 'NvmlUnknownError'
  | 'SidecarUnavailable'
  | 'UnknownError';

@Injectable({
  providedIn: 'root',
})
export class NvmlService {
  private _devices: BehaviorSubject<NvmlDevice[]> = new BehaviorSubject<NvmlDevice[]>([]);
  public devices: Observable<NvmlDevice[]> = this._devices.asObservable();
  private _status: BehaviorSubject<NvmlStatus> = new BehaviorSubject<NvmlStatus>('Initializing');
  public status: Observable<NvmlStatus> = this._status.asObservable();

  constructor(private sidecar: ElevatedSidecarService) {}

  async init() {
    this.sidecar.sidecarStarted
      .pipe(
        filter((running) => running),
        switchMap(() => interval(5000).pipe(startWith(null))),
        delay(1000)
      )
      .subscribe(() => this.handleNvmlStatusUpdate());
  }

  private async handleNvmlStatusUpdate() {
    const status = await this.getNvmlStatus();
    if (status === this._status.value) return;
    this._status.next(status);
    if (status === 'InitComplete') {
      this._devices.next(await this.getDevices());
    }
  }

  private getDevices(): Promise<Array<NvmlDevice>> {
    return invoke<NvmlDevice[]>('nvml_get_devices');
  }

  public async setPowerLimit(uuid: string, powerLimit: number): Promise<boolean> {
    powerLimit = Math.floor(powerLimit);
    const success = await invoke<boolean>('nvml_set_power_management_limit', { uuid, powerLimit });
    if (success) {
      this._devices.next(await this.getDevices());
      info(`[Nvml] Set gpu power limit (uuid=${uuid}, powerLimit:${powerLimit})`);
    } else {
      error(`[Nvml] Could not set gpu power limit (uuid=${uuid}, powerLimit:${powerLimit})`);
    }
    return success;
  }

  private getNvmlStatus(): Promise<NvmlStatus> {
    return invoke<NvmlStatus>('nvml_status');
  }
}
