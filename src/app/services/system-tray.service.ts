import { Injectable } from '@angular/core';
import { AppSettingsService } from './app-settings.service';
import { debounceTime, filter, first, last, map, pairwise, take } from 'rxjs';
import { invoke } from '@tauri-apps/api';

const SYSTEM_TRAY_EXIT_COMMAND = 'set_exit_in_system_tray';
const START_WITH_SYSTEM_TRAY_COMMAND = 'set_start_in_system_tray';

@Injectable({
  providedIn: 'root',
})
export class SystemTrayService {
  constructor(private readonly _appSettingsService: AppSettingsService) {
  }
  
  async init() {
    // Update exit in system tray behaviour following the setting.
    this._appSettingsService.settings
      .pipe(
        map(settings => settings.exitInSystemTray),
        pairwise(),
        filter(([oldVal, newVal]) => oldVal !== newVal),
        map(([_, newVal]) => newVal),
        debounceTime(100)
      )
      .subscribe(exitInSystemTray => this.updateSystemTrayExit(exitInSystemTray));

    // Update start in system tray behaviour following the settings.
    // Send command only upon loading setings, in order to hide or show the window upon startup.
    this._appSettingsService.settings
      .pipe(
        map(settings => settings.startInSystemTray),
        pairwise(),
        filter(([oldVal, newVal]) => oldVal !== newVal),
        map(([_, newVal]) => newVal),
        debounceTime(100)
      )
    .subscribe(startInSystemTray => this.updateSystemTrayStart(startInSystemTray));
  }

  private async updateSystemTrayExit(exitInSystemTray: boolean) {
    await invoke(SYSTEM_TRAY_EXIT_COMMAND, { status: exitInSystemTray });
  }

  private async updateSystemTrayStart(startInSystemTray: boolean) {
    await invoke(START_WITH_SYSTEM_TRAY_COMMAND, { status: startInSystemTray });
  }
}
