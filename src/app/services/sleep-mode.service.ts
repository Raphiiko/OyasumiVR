import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { SleepModeStatusChangeReason } from '../models/sleep-mode';

@Injectable({
  providedIn: 'root',
})
export class SleepModeService {
  private _sleepMode: BehaviorSubject<boolean> = new BehaviorSubject<boolean>(false);
  public sleepMode: Observable<boolean> = this._sleepMode.asObservable();

  constructor() {}

  enableSleepMode(reason: SleepModeStatusChangeReason) {
    if (this._sleepMode.value) return;
    reason.enabled = true;
    console.log(reason);
    this._sleepMode.next(true);
  }

  disableSleepMode(reason: SleepModeStatusChangeReason) {
    if (!this._sleepMode.value) return;
    reason.enabled = false;
    console.log(reason);
    this._sleepMode.next(false);
  }
}
