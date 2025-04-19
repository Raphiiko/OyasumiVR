import { Injectable } from '@angular/core';
import { AppSettingsService } from './app-settings.service';
import { TrayIcon } from '@tauri-apps/api/tray';
import { Menu } from '@tauri-apps/api/menu';
import { getVersion } from '../utils/app-utils';
import { BUILD_ID } from 'src-ui/build';
import {
  BehaviorSubject,
  combineLatest,
  debounceTime,
  distinctUntilChanged,
  firstValueFrom,
  map,
  startWith,
} from 'rxjs';
import { SleepService } from './sleep.service';
import { TranslateService } from '@ngx-translate/core';
import { error } from '@tauri-apps/plugin-log';
import { invoke } from '@tauri-apps/api/core';

const CLOSE_TO_SYSTEM_TRAY_COMMAND = 'set_close_to_system_tray';

@Injectable({
  providedIn: 'root',
})
export class SystemTrayService {
  private readonly _tray = new BehaviorSubject<TrayIcon | null>(null);

  constructor(
    private readonly appSettingsService: AppSettingsService,
    private readonly sleepService: SleepService,
    private readonly translateService: TranslateService
  ) {}

  public async init() {
    const tray = await TrayIcon.getById('oyasumivr-tray');
    if (!tray) {
      error('[SystemTrayService] Tray icon not found');
      throw new Error('Tray icon not found');
    }
    this._tray.next(tray);
    combineLatest([
      this.sleepService.mode,
      this.translateService.onLangChange.pipe(startWith(this.translateService.currentLang)),
    ])
      .pipe(debounceTime(50))
      .subscribe(() => this.rebuildMenu());
    // await listen<'Left' | 'Right' | string>('system_tray_click', (event) => {});
    // await listen<'Left' | 'Right' | string>('system_tray_double_click', (event) => {});
    this.appSettingsService.settings
      .pipe(
        map((settings) => settings.exitInSystemTray),
        distinctUntilChanged(),
        debounceTime(100)
      )
      .subscribe(async (enabled) => {
        await invoke(CLOSE_TO_SYSTEM_TRAY_COMMAND, { enabled });
      });
  }

  private async rebuildMenu(): Promise<void> {
    if (this._tray.value == null) return;
    const menu = await this.buildMenu();
    this._tray.value?.setMenu(menu);
  }

  private async buildMenu(): Promise<Menu> {
    return Menu.new({
      items: [
        {
          text: `OyasumiVR v${await getVersion()} (${BUILD_ID})`,
          enabled: false,
        },
        {
          item: 'Separator',
        },
        {
          text: this.translateService.instant('systemTray.sleepMode'),
          checked: await firstValueFrom(this.sleepService.mode),
          action: async () => {
            if (await firstValueFrom(this.sleepService.mode)) {
              this.sleepService.disableSleepMode({ type: 'MANUAL' });
            } else {
              this.sleepService.enableSleepMode({ type: 'MANUAL' });
            }
          },
        },
        {
          item: 'Separator',
        },
        {
          text: this.translateService.instant('systemTray.quit'),
          item: 'Quit',
        },
      ],
    });
  }
}
