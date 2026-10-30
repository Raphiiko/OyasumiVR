import { Injectable } from '@angular/core';
import { commands, NvmlDevice, NvmlStatus } from 'src-ui/app/bindings';
import { BehaviorSubject, delay, filter, interval, Observable, startWith, switchMap } from 'rxjs';
import { ElevatedSidecarService } from './elevated-sidecar.service';
import { info } from '@tauri-apps/plugin-log';

export type { NvmlStatus };

/** Statuses the Message Centre posts a warning for; GpuAutomationMessageMonitor lists them too. */
export const NVML_ERROR_STATUSES: NvmlStatus[] = [
  'DriverNotLoaded',
  'LibLoadingError',
  'NoPermission',
  'NvmlUnknownError',
  'UnknownError',
];

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
    return commands.nvmlGetDevices();
  }

  /** Rejects with the sidecar's error name when NVML refuses the limit. */
  public async setPowerLimit(uuid: string, powerLimit: number): Promise<void> {
    powerLimit = Math.floor(powerLimit);
    const result = await commands.nvmlSetPowerManagementLimit(uuid, powerLimit);
    if (result.status === 'error') throw result.error;
    this._devices.next(await this.getDevices());
    info(`[Nvml] Set gpu power limit (uuid=${uuid}, powerLimit:${powerLimit})`);
  }

  private getNvmlStatus(): Promise<NvmlStatus> {
    return commands.nvmlStatus();
  }
}
