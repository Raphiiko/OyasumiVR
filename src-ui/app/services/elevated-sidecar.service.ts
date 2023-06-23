import { Injectable } from '@angular/core';
import { invoke } from '@tauri-apps/api';
import { BehaviorSubject, firstValueFrom, Observable } from 'rxjs';
import { listen } from '@tauri-apps/api/event';
import { AppSettingsService } from './app-settings.service';
import { info } from 'tauri-plugin-log-api';

@Injectable({
  providedIn: 'root',
})
export class ElevatedSidecarService {
  private _sidecarStarted: BehaviorSubject<boolean> = new BehaviorSubject<boolean>(false);
  public sidecarStarted: Observable<boolean> = this._sidecarStarted.asObservable();

  constructor(private appSettings: AppSettingsService) {}

  async init() {
    this._sidecarStarted.next(await this.checkIfStarted());
    await Promise.all([
      listen<boolean>('ELEVATED_SIDECAR_STARTED', () => {
        info('[ElevatedSidecar] Elevated sidecar has started');
        this._sidecarStarted.next(true);
      }),
      listen<boolean>('ELEVATED_SIDECAR_STOPPED', () => {
        info('[ElevatedSidecar] Elevated sidecar has stopped');
        this._sidecarStarted.next(false);
      }),
    ]);
    if (
      !this._sidecarStarted.value &&
      (await firstValueFrom(this.appSettings.settings)).askForAdminOnStart
    ) {
      this.start();
    }
  }

  async start() {
    if (await this.checkIfStarted()) return;
    info('[ElevatedSidecar] Starting elevated sidecar...');
    return await invoke('start_elevated_sidecar');
  }

  async checkIfStarted(): Promise<boolean> {
    return await invoke('elevated_sidecar_started');
  }
}
