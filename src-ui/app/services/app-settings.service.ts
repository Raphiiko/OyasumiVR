import { Injectable } from '@angular/core';
import { APP_SETTINGS_DEFAULT, AppSettings } from '../models/settings';
import {
  asyncScheduler,
  BehaviorSubject,
  concatMap,
  distinctUntilChanged,
  firstValueFrom,
  map,
  Observable,
  skip,
  throttleTime,
} from 'rxjs';
import { SETTINGS_KEY_APP_SETTINGS, SETTINGS_STORE } from '../globals';
import { isEqual, uniq } from 'lodash';
import { migrateAppSettings } from '../migrations/app-settings.migrations';
import { protectSecret, unprotectSecret } from '../utils/secrets';
import { error } from '@tauri-apps/plugin-log';
import { TranslocoService } from '@jsverse/transloco';
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
  private _settings: BehaviorSubject<AppSettings> = new BehaviorSubject<AppSettings>(
    APP_SETTINGS_DEFAULT
  );
  settings: Observable<AppSettings> = this._settings.asObservable();
  private storedMqttPassword: { plain: string; protected: string } | null = null;
  public get settingsSync(): AppSettings {
    return this._settings.value;
  }
  private _loadedDefaults: BehaviorSubject<boolean | undefined> = new BehaviorSubject<
    boolean | undefined
  >(undefined);
  public loadedDefaults: Observable<boolean | undefined> = this._loadedDefaults.asObservable();

  constructor(
    private translateService: TranslocoService,
    private modalService: ModalService
  ) {}

  async init() {
    await this.loadSettings();
    this._settings
      .pipe(
        skip(1),
        throttleTime(500, asyncScheduler, { leading: true, trailing: true }),
        distinctUntilChanged((a, b) => isEqual(a, b)),
        concatMap(() => this.saveSettings())
      )
      .subscribe();
  }

  async loadSettings() {
    let settings: AppSettings | undefined =
      await SETTINGS_STORE.get<AppSettings>(SETTINGS_KEY_APP_SETTINGS);
    let loadedDefaults = false;
    if (settings) {
      const oldSettings = structuredClone(settings);
      settings = await migrateAppSettings(settings);
      if (oldSettings.userLanguage !== settings.userLanguage) {
        this.translateService.setActiveLang(settings.userLanguage);
      }
    } else {
      settings = this._settings.value;
      loadedDefaults = true;
    }
    if (settings.userLanguage === 'DEBUG') settings.userLanguage = 'en';
    const stored = settings.mqttProtectedPassword;
    settings.mqttPassword = await unprotectSecret(stored);
    this.storedMqttPassword =
      stored && settings.mqttPassword ? { plain: settings.mqttPassword, protected: stored } : null;
    // Hold on to a password that cannot be unlocked, so the save below rewrites it instead of nothing
    settings.mqttProtectedPassword = settings.mqttPassword ? null : stored;
    this._settings.next(settings);
    await this.saveSettings();
    this._loadedDefaults.next(loadedDefaults);
  }

  async saveSettings() {
    const settings = this._settings.value;
    let mqttProtectedPassword = settings.mqttProtectedPassword;
    if (settings.mqttPassword && this.storedMqttPassword?.plain === settings.mqttPassword) {
      mqttProtectedPassword = this.storedMqttPassword.protected;
    } else if (settings.mqttPassword) {
      try {
        mqttProtectedPassword = await protectSecret(settings.mqttPassword);
        this.storedMqttPassword = mqttProtectedPassword
          ? { plain: settings.mqttPassword, protected: mqttProtectedPassword }
          : null;
      } catch (cause) {
        error(
          `[AppSettings] Could not protect the MQTT password, so the stored one goes: ${cause}`
        );
        mqttProtectedPassword = null;
        this.storedMqttPassword = null;
      }
    }
    await SETTINGS_STORE.set(SETTINGS_KEY_APP_SETTINGS, {
      ...settings,
      mqttPassword: null,
      mqttProtectedPassword,
    });
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

  public async promptDialogForOneTimeFlag(flag: OneTimeFlag, force = false): Promise<boolean> {
    if (this.oneTimeFlagSet(flag) && !force) return false;
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
