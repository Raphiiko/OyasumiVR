import { Injectable } from '@angular/core';
import { invoke } from '@tauri-apps/api/core';
import { NvmlDevice as NvmlDevice } from '../models/nvml-device';
import { BehaviorSubject, delay, EMPTY, interval, Observable, startWith, switchMap } from 'rxjs';
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

  /** Starts five-second polling while the sidecar runs and clears GPU state when it stops. */
  async init() {
    this.sidecar.sidecarStarted
      .pipe(
        switchMap((running) => {
          if (!running) {
            this._devices.next([]);
            this._status.next('SidecarUnavailable');
            return EMPTY;
          }

          return interval(5000).pipe(startWith(null));
        }),
        delay(1000)
      )
      .subscribe(() => this.handleNvmlStatusUpdate());
  }

  /** Refreshes devices on every ready poll and clears them when transitioning to a non-ready state. */
  private async handleNvmlStatusUpdate() {
    const status = await this.getNvmlStatus();
    if (status === 'InitComplete') {
      if (status !== this._status.value) {
        this._status.next(status);
      }
      this._devices.next(await this.getDevices());
      return;
    }

    if (status === this._status.value) return;
    this._status.next(status);
    this._devices.next([]);
  }

  private getDevices(): Promise<Array<NvmlDevice>> {
    return invoke<NvmlDevice[]>('nvml_get_devices');
  }

  /**
   * Sends NVIDIA milliwatts or AMD `(offset + 100) * 1000`, then refreshes devices on success.
   * Returns false if the write is rejected or the write/refresh invocation throws.
   */
  public async setPowerLimit(uuid: string, powerLimit: number): Promise<boolean> {
    const backend = uuid.startsWith('adlx:') ? 'ADLX' : 'NVML';
    powerLimit = Math.floor(powerLimit);
    try {
      const success = await invoke<boolean>('nvml_set_power_management_limit', {
        uuid,
        powerLimit,
      });
      if (success) {
        this._devices.next(await this.getDevices());
        info(`[${backend}] Set gpu power limit (uuid=${uuid}, powerLimit:${powerLimit})`);
      } else {
        error(
          `[${backend}] Could not set gpu power limit (uuid=${uuid}, powerLimit:${powerLimit})`
        );
      }
      return success;
    } catch (e) {
      error(
        `[${backend}] Could not set gpu power limit (uuid=${uuid}, powerLimit:${powerLimit}): ${e}`
      );
      return false;
    }
  }

  private getNvmlStatus(): Promise<NvmlStatus> {
    return invoke<NvmlStatus>('nvml_status');
  }
}
