import { Injectable } from '@angular/core';
import { AppSettingsService } from './app-settings.service';
import { debounceTime, filter, map, pairwise } from 'rxjs';
import { invoke } from '@tauri-apps/api';

const SYSTEM_TRAY_EXIT_COMMAND = 'set_exit_with_system_tray';

@Injectable({
  providedIn: 'root',
})
export class SystemTrayService {
  constructor(private readonly _appSettingsService: AppSettingsService) {
  }
  
  async init() {
    // Update tauri system tray status when the system tray exit value is changed in the settings.
    this._appSettingsService.settings
      .pipe(
        map(settings => settings.exitWithSystemTray),
        pairwise(),
        filter(([oldVal, newVal]) => oldVal !== newVal),
        map(([_, newVal]) => newVal),
        debounceTime(100)
      )
      .subscribe(exitWithSystemTray => this.updateSystemTrayExit(exitWithSystemTray));
  }

  private async updateSystemTrayExit(exitWithSystemTray: boolean) {
    await invoke(SYSTEM_TRAY_EXIT_COMMAND, { status: exitWithSystemTray });
  }
}
