import { Injectable } from '@angular/core';
import {
  AUTOMATION_DEFAULT_CONFIG,
  AutomationConfig,
  AutomationConfigs,
  AutomationType,
} from '../models/automations';
import { asyncScheduler, BehaviorSubject, Observable, skip, switchMap, throttleTime } from 'rxjs';
import { Store } from 'tauri-plugin-store-api';
import { SETTINGS_FILE } from '../globals';
import { cloneDeep } from 'lodash';

export const SETTINGS_KEY_AUTOMATION_CONFIGS = 'AUTOMATION_CONFIGS';

@Injectable({
  providedIn: 'root',
})
export class AutomationConfigService {
  private store = new Store(SETTINGS_FILE);
  private _configs: BehaviorSubject<AutomationConfigs> = new BehaviorSubject<AutomationConfigs>(
    AUTOMATION_DEFAULT_CONFIG
  );
  configs: Observable<AutomationConfigs> = this._configs.asObservable();

  constructor() {
    this.init();
  }

  async init() {
    await this.loadConfigs();
    this.configs
      .pipe(
        skip(1),
        throttleTime(500, asyncScheduler, { leading: false, trailing: true }),
        switchMap(() => this.saveConfigs())
      )
      .subscribe();
  }

  async updateAutomationConfig<T extends AutomationConfig>(automation: AutomationType, config: T) {
    const configs = Object.assign({}, this._configs.value);
    configs[automation] = config as any;
    this._configs.next(configs);
  }

  async loadConfigs() {
    let configs: AutomationConfigs | null = await this.store.get<AutomationConfigs>(
      SETTINGS_KEY_AUTOMATION_CONFIGS
    );
    if (!configs) {
      await this.saveConfigs();
      this._configs.next(this._configs.value);
    } else {
      configs = Object.assign({}, cloneDeep(this._configs.value), configs);
      this._configs.next(configs);
    }
  }

  async saveConfigs() {
    await this.store.set(SETTINGS_KEY_AUTOMATION_CONFIGS, this._configs.value);
    await this.store.save();
  }
}
