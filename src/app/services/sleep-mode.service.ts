import { Injectable } from '@angular/core';
import {
  AsyncSubject,
  BehaviorSubject,
  filter,
  map,
  Observable,
  ReplaySubject,
  Subject,
} from 'rxjs';
import { SleepModeStatusChangeReason } from '../models/sleep-mode';
import { SETTINGS_FILE } from '../globals';
import { Store } from 'tauri-plugin-store-api';

export const SETTINGS_KEY_SLEEP_MODE = 'SLEEP_MODE';

@Injectable({
  providedIn: 'root',
})
export class SleepModeService {
  private store = new Store(SETTINGS_FILE);
  private _sleepMode: BehaviorSubject<boolean | null> = new BehaviorSubject<boolean | null>(null);
  public sleepMode: Observable<boolean> = this._sleepMode.asObservable().pipe(
    filter((v) => v !== null),
    map((v) => v as boolean)
  );

  constructor() {}

  async init() {
    this._sleepMode.next((await this.store.get<boolean>(SETTINGS_KEY_SLEEP_MODE)) || false);
  }

  async enableSleepMode(reason: SleepModeStatusChangeReason) {
    if (this._sleepMode.value) return;
    reason.enabled = true;
    console.log(reason);
    this._sleepMode.next(true);
    await this.store.set(SETTINGS_KEY_SLEEP_MODE, true);
    await this.store.save();
  }

  async disableSleepMode(reason: SleepModeStatusChangeReason) {
    if (!this._sleepMode.value) return;
    reason.enabled = false;
    console.log(reason);
    this._sleepMode.next(false);
    await this.store.set(SETTINGS_KEY_SLEEP_MODE, false);
    await this.store.save();
  }
}
