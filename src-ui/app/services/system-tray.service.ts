import { Injectable } from '@angular/core';
import { AppSettingsService } from './app-settings.service';
import { debounceTime, distinctUntilChanged, map } from 'rxjs';
import { invoke } from '@tauri-apps/api/core';

const CLOSE_TO_SYSTEM_TRAY_COMMAND = 'set_close_to_system_tray';
const START_IN_SYSTEM_TRAY_COMMAND = 'set_start_in_system_tray';

@Injectable({
  providedIn: 'root',
})
export class SystemTrayService {
  constructor(private readonly _appSettingsService: AppSettingsService) {}

  async init() {
    // Update exit in system tray behaviour following the setting.
    this._appSettingsService.settings
      .pipe(
        map((settings) => settings.exitInSystemTray),
        distinctUntilChanged(),
        debounceTime(100)
      )
      .subscribe((exitInSystemTray) => this.updateCloseToSystemTray(exitInSystemTray));

    // Update start in system tray behaviour following the settings.
    // Send command only upon loading settings, in order to hide or show the window upon startup.
    this._appSettingsService.settings
      .pipe(
        map((settings) => settings.startInSystemTray),
        distinctUntilChanged(),
        debounceTime(100)
      )
      .subscribe((startInSystemTray) => this.updateStartInSystemTray(startInSystemTray));
  }

  private async updateCloseToSystemTray(enabled: boolean) {
    await invoke(CLOSE_TO_SYSTEM_TRAY_COMMAND, { enabled });
  }

  private async updateStartInSystemTray(enabled: boolean) {
    await invoke(START_IN_SYSTEM_TRAY_COMMAND, { enabled });
  }
}
