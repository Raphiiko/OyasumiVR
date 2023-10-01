import { Injectable } from '@angular/core';
import { QuitWithSteamVRMode } from '../models/settings';
import { AppSettingsService } from './app-settings.service';
import { OpenVRService } from './openvr.service';
import { debounceTime, EMPTY, filter, firstValueFrom, of, pairwise, switchMap } from 'rxjs';
import { exit } from '@tauri-apps/api/process';
import { info } from 'tauri-plugin-log-api';

@Injectable({
  providedIn: 'root',
})
export class QuitWithSteamVRService {
  private mode: QuitWithSteamVRMode = 'DISABLED';

  constructor(private appSettings: AppSettingsService, private openvr: OpenVRService) {}

  async init() {
    this.appSettings.settings.subscribe((settings) => {
      this.mode = settings.quitWithSteamVR;
    });
    this.openvr.status
      .pipe(
        filter((status) => ['INACTIVE', 'INITIALIZED'].includes(status)),
        pairwise(),
        filter(([oldStatus, newStatus]) => oldStatus === 'INITIALIZED' && newStatus === 'INACTIVE'),
        switchMap(async () => {
          if (this.mode === 'AFTERDELAY') return of(void 0);
          if (this.mode === 'IMMEDIATELY') {
            info('[QuitWithSteamVR] SteamVR has stopped: quitting OyasumiVR immediately.');
            await exit(0);
          }
          return EMPTY;
        }),
        debounceTime(1000 * 60 * 2),
        switchMap(async () => {
          if (
            this.mode === 'AFTERDELAY' &&
            (await firstValueFrom(this.openvr.status)) === 'INACTIVE'
          ) {
            info('[QuitWithSteamVR] SteamVR has stopped for 2 minutes: quitting OyasumiVR.');
            await exit(0);
          }
          return EMPTY;
        })
      )
      .subscribe();
  }
}
