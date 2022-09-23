import { Injectable } from '@angular/core';
import { invoke } from '@tauri-apps/api';
import { BehaviorSubject, firstValueFrom, map, Observable } from 'rxjs';
import { listen } from '@tauri-apps/api/event';
import { DeviceUpdateEvent } from '../models/events';
import { AppSettingsService } from './app-settings.service';

@Injectable({
  providedIn: 'root',
})
export class ElevatedSidecarService {
  private _sidecarRunning: BehaviorSubject<number> = new BehaviorSubject<number>(-1);
  public sidecarRunning: Observable<boolean> = this._sidecarRunning
    .asObservable()
    .pipe(map((pid) => pid !== -1));

  constructor(private appSettings: AppSettingsService) {}

  async init() {
    const pid: number | null = await this.checkIfRunning();
    if (pid) this._sidecarRunning.next(pid);
    await Promise.all([
      listen<number>('ELEVATED_SIDECAR_STARTED', (event) => {
        this._sidecarRunning.next(event.payload);
      }),
      listen<number>('ELEVATED_SIDECAR_STOPPED', (event) => {
        if (this._sidecarRunning.value === event.payload) {
          this._sidecarRunning.next(-1);
        }
      }),
    ]);
    if (
      this._sidecarRunning.value === -1 &&
      (await firstValueFrom(this.appSettings.settings)).askForAdminOnStart
    ) {
      this.start();
    }
  }

  async start() {
    if (await this.checkIfRunning()) return;
    return await invoke('start_elevation_sidecar');
  }

  /// Check if the sidecar is running by pinging it and returns the pid if it is.
  async checkIfRunning(): Promise<number | null> {
    return await invoke('elevation_sidecar_running');
  }
}
