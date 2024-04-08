import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { listen } from '@tauri-apps/api/event';
import { info } from 'tauri-plugin-log-api';
import { invoke } from '@tauri-apps/api';

@Injectable({
  providedIn: 'root',
})
export class MdnsSidecarService {
  private _sidecarStarted: BehaviorSubject<boolean> = new BehaviorSubject<boolean>(false);
  public sidecarStarted: Observable<boolean> = this._sidecarStarted.asObservable();

  constructor() {}

  public async init() {
    this._sidecarStarted.next(await this.checkIfStarted());
    await Promise.all([
      listen<boolean>('MDNS_SIDECAR_STARTED', () => {
        info('[MDNSSidecar] MDNS sidecar has started');
        this._sidecarStarted.next(true);
      }),
      listen<boolean>('MDNS_SIDECAR_STOPPED', () => {
        info('[MDNSSidecar] MDNS sidecar has stopped');
        this._sidecarStarted.next(false);
      }),
    ]);
  }

  async checkIfStarted(): Promise<boolean> {
    return await invoke('mdns_sidecar_started');
  }
}
