import { Injectable } from '@angular/core';
import { invoke } from '@tauri-apps/api/core';
import { BehaviorSubject, firstValueFrom, Observable } from 'rxjs';
import { listen } from '@tauri-apps/api/event';
import { AppSettingsService } from './app-settings.service';
import { info } from '@tauri-apps/plugin-log';

export type EnableResult =
  | { result: 'ok' }
  | { result: 'promptDeclined' }
  | { result: 'installFailed' }
  | { result: 'taskFailed'; reason: string }
  | { result: 'notSupported' };

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
      (await firstValueFrom(this.appSettings.settings)).elevatedFeaturesEnabled
    ) {
      await this.enable();
    }
  }

  // installs the privileged launcher if needed, repairs it if broken, then starts the sidecar
  async enable(): Promise<EnableResult> {
    this.appSettings.updateSettings({ elevatedFeaturesEnabled: true });
    let result: EnableResult;
    try {
      result = await invoke<EnableResult>('elevated_features_enable');
    } catch (e) {
      info(`[ElevatedSidecar] Could not enable elevated features: ${e}`);
      return { result: 'installFailed' };
    }
    if (result.result !== 'ok') {
      info(`[ElevatedSidecar] Could not enable elevated features: ${result.result}`);
    }
    // Only the user declining and an account that cannot elevate are decisions. Everything else
    // is a failure worth retrying, and clearing the setting would turn the feature off for good.
    if (result.result === 'promptDeclined' || result.result === 'notSupported') {
      this.appSettings.updateSettings({ elevatedFeaturesEnabled: false });
    }
    return result;
  }

  async disable() {
    this.appSettings.updateSettings({ elevatedFeaturesEnabled: false });
    try {
      await invoke('elevated_features_disable');
    } catch (e) {
      info(`[ElevatedSidecar] Could not disable elevated features: ${e}`);
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
