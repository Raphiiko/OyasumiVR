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
import { TranslocoService } from '@jsverse/transloco';
import { error } from '@tauri-apps/plugin-log';
import { commands } from 'src-ui/app/bindings';
import { SleepPreparationService } from './sleep-preparation.service';

@Injectable({
  providedIn: 'root',
})
export class SystemTrayService {
  private readonly _tray = new BehaviorSubject<TrayIcon | null>(null);

  constructor(
    private readonly appSettingsService: AppSettingsService,
    private readonly sleepService: SleepService,
    private readonly sleepPreparationService: SleepPreparationService,
    private readonly translateService: TranslocoService
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
      this.sleepPreparationService.sleepPreparationAvailable,
      this.sleepPreparationService.sleepPreparationTimedOut,
      this.translateService.langChanges$.pipe(startWith(this.translateService.getActiveLang())),
    ])
      .pipe(debounceTime(50))
      .subscribe(() => this.rebuildMenu());
    this.appSettingsService.settings
      .pipe(
        map((settings) => settings.exitInSystemTray),
        distinctUntilChanged(),
        debounceTime(100)
      )
      .subscribe(async (enabled) => {
        await commands.setCloseToSystemTray(enabled);
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
          text: this.translateService.translate<string>('systemTray.sleepMode'),
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
          text: this.translateService.translate<string>('systemTray.prepareForSleep'),
          enabled:
            (await firstValueFrom(this.sleepPreparationService.sleepPreparationAvailable)) &&
            !(await firstValueFrom(this.sleepPreparationService.sleepPreparationTimedOut)),
          action: async () => {
            await this.sleepPreparationService.prepareForSleep();
          },
        },
        {
          item: 'Separator',
        },
        {
          text: this.translateService.translate<string>('systemTray.quit'),
          item: 'Quit',
        },
      ],
    });
  }
}
