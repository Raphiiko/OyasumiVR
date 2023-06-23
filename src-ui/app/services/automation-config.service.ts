import { Injectable } from '@angular/core';
import {
  AUTOMATION_CONFIGS_DEFAULT,
  AutomationConfig,
  AutomationConfigs,
  AutomationType,
} from '../models/automations';
import { asyncScheduler, BehaviorSubject, Observable, skip, switchMap, throttleTime } from 'rxjs';
import { Store } from 'tauri-plugin-store-api';
import { SETTINGS_FILE, SETTINGS_KEY_AUTOMATION_CONFIGS } from '../globals';
import { cloneDeep } from 'lodash';
import { migrateAutomationConfigs } from '../migrations/automation-configs.migrations';

@Injectable({
  providedIn: 'root',
})
export class AutomationConfigService {
  private store = new Store(SETTINGS_FILE);
  private _configs: BehaviorSubject<AutomationConfigs> = new BehaviorSubject<AutomationConfigs>(
    AUTOMATION_CONFIGS_DEFAULT
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

  async updateAutomationConfig<T extends AutomationConfig>(
    automation: AutomationType,
    config: Partial<T>
  ) {
    const configs: AutomationConfigs = cloneDeep(this._configs.value);
    configs[automation] = Object.assign({}, configs[automation], config) as any;
    this._configs.next(configs);
  }

  async loadConfigs() {
    let configs: AutomationConfigs | null = await this.store.get<AutomationConfigs>(
      SETTINGS_KEY_AUTOMATION_CONFIGS
    );
    configs = configs ? migrateAutomationConfigs(configs) : this._configs.value;
    this._configs.next(configs);
    await this.saveConfigs();
  }

  async saveConfigs() {
    await this.store.set(SETTINGS_KEY_AUTOMATION_CONFIGS, this._configs.value);
    await this.store.save();
  }
}
