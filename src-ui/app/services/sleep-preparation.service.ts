import { Injectable } from '@angular/core';
import { BehaviorSubject, firstValueFrom, map, Subject, switchMap } from 'rxjs';
import { AutomationConfigService } from './automation-config.service';

const SLEEP_PREPARATION_TIMEOUT = 5000;

@Injectable({
  providedIn: 'root',
})
export class SleepPreparationService {
  private readonly _sleepPreparationTimedOut = new BehaviorSubject<boolean>(false);
  public readonly sleepPreparationTimedOut = this._sleepPreparationTimedOut.asObservable();
  private readonly _onSleepPreparation = new Subject<void>();
  public readonly onSleepPreparation = this._onSleepPreparation.asObservable();

  public readonly sleepPreparationAvailable = this.automationConfigService.configs.pipe(
    map((configs) => [configs.SET_BRIGHTNESS_ON_SLEEP_PREPARATION.enabled].some(Boolean))
  );

  constructor(private automationConfigService: AutomationConfigService) {}

  public async prepareForSleep() {
    if (await firstValueFrom(this.sleepPreparationAvailable)) {
      this._sleepPreparationTimedOut.next(true);
      this._onSleepPreparation.next();
      setTimeout(() => this._sleepPreparationTimedOut.next(false), SLEEP_PREPARATION_TIMEOUT);
    }
  }
}
