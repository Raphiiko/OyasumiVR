import { Injectable } from '@angular/core';
import { APP_SETTINGS_DEFAULT, AppSettings } from '../models/settings';
import {
  asyncScheduler,
  BehaviorSubject,
  firstValueFrom,
  map,
  Observable,
  skip,
  switchMap,
  throttleTime,
} from 'rxjs';
import { LazyStore } from '@tauri-apps/plugin-store';
import { SETTINGS_FILE, SETTINGS_KEY_APP_SETTINGS } from '../globals';
import { isEqual, uniq } from 'lodash';
import { migrateAppSettings } from '../migrations/app-settings.migrations';
import { TranslateService } from '@ngx-translate/core';
import { OneTimeFlag } from '../models/one-time-flags';
import { ModalService } from './modal.service';
import {
  ConfirmModalComponent,
  ConfirmModalInputModel,
  ConfirmModalOutputModel,
} from '../components/confirm-modal/confirm-modal.component';

@Injectable({
  providedIn: 'root',
})
export class AppSettingsService {
  private store = new LazyStore(SETTINGS_FILE);
  private _settings: BehaviorSubject<AppSettings> = new BehaviorSubject<AppSettings>(
    APP_SETTINGS_DEFAULT
  );
  settings: Observable<AppSettings> = this._settings.asObservable();
  public get settingsSync(): AppSettings {
    return this._settings.value;
  }
  private _loadedDefaults: BehaviorSubject<boolean | undefined> = new BehaviorSubject<
    boolean | undefined
  >(undefined);
  public loadedDefaults: Observable<boolean | undefined> = this._loadedDefaults.asObservable();

  constructor(private translateService: TranslateService, private modalService: ModalService) {}

  async init() {
    await this.loadSettings();
    this._settings
      .pipe(
        skip(1),
        throttleTime(500, asyncScheduler, { leading: true, trailing: true }),
        switchMap(() => this.saveSettings())
      )
      .subscribe();
  }

  async loadSettings() {
    let settings: AppSettings | undefined = await this.store.get<AppSettings>(
      SETTINGS_KEY_APP_SETTINGS
    );
    let loadedDefaults = false;
    if (settings) {
      const oldSettings = structuredClone(settings);
      settings = migrateAppSettings(settings);
      if (oldSettings.userLanguage !== settings.userLanguage) {
        this.translateService.use(settings.userLanguage);
      }
    } else {
      settings = this._settings.value;
      loadedDefaults = true;
    }
    if (settings.userLanguage === 'DEBUG') settings.userLanguage = 'en';
    this._settings.next(settings);
    await this.saveSettings();
    this._loadedDefaults.next(loadedDefaults);
  }

  async saveSettings() {
    await this.store.set(SETTINGS_KEY_APP_SETTINGS, this._settings.value);
    await this.store.save();
  }

  public updateSettings(settings: Partial<AppSettings>) {
    const newSettings = Object.assign(structuredClone(this._settings.value), settings);
    if (isEqual(newSettings, this._settings.value)) return;
    this._settings.next(newSettings);
  }

  public oneTimeFlagSet(flag: OneTimeFlag): boolean {
    return this._settings.value.oneTimeFlags.includes(flag);
  }
  public oneTimeFlagSetAsync(flag: OneTimeFlag): Observable<boolean> {
    return this._settings.pipe(map((settings) => settings.oneTimeFlags.includes(flag)));
  }

  public setOneTimeFlag(flag: OneTimeFlag, set = true): void {
    if (set === this.oneTimeFlagSet(flag)) return;
    const oneTimeFlags = [...this._settings.value.oneTimeFlags];
    if (set) oneTimeFlags.push(flag);
    else if (oneTimeFlags.indexOf(flag) > -1) oneTimeFlags.splice(oneTimeFlags.indexOf(flag), 1);
    this.updateSettings({ oneTimeFlags: uniq(oneTimeFlags) });
  }

  public async promptDialogForOneTimeFlag(flag: OneTimeFlag): Promise<boolean> {
    if (this.oneTimeFlagSet(flag)) return false;
    const result: ConfirmModalOutputModel | undefined = await firstValueFrom(
      this.modalService.addModal<ConfirmModalInputModel, ConfirmModalOutputModel>(
        ConfirmModalComponent,
        {
          title: `misc.oneTimeFlagDialogs.${flag}.title`,
          message: `misc.oneTimeFlagDialogs.${flag}.message`,
          confirmButtonText: 'misc.oneTimeFlagDialogs.acknowledge',
          showCancel: false,
        },
        {
          closeOnEscape: false,
        }
      )
    );
    const confirmed = result?.confirmed ?? false;
    if (confirmed) this.setOneTimeFlag(flag);
    return confirmed;
  }
}
