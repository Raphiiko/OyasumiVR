import { Injectable } from '@angular/core';
import { BrightnessControlDriver } from './drivers/brightness-control-driver';
import { ValveIndexBrightnessControlDriver } from './drivers/valve-index-brightness-control-driver';
import { OpenVRService } from '../openvr.service';
import {
  BehaviorSubject,
  filter,
  firstValueFrom,
  Observable,
  of,
  pairwise,
  startWith,
  switchMap,
} from 'rxjs';
import { isEqual } from 'lodash';
import { info } from 'tauri-plugin-log-api';
import { CancellableTask } from '../../utils/cancellable-task';
import { createBrightnessTransitionTask } from './brightness-transition';

@Injectable({
  providedIn: 'root',
})
export class BrightnessControlService {
  private driver: BehaviorSubject<BrightnessControlDriver | null> =
    new BehaviorSubject<BrightnessControlDriver | null>(null);
  private _brightness: BehaviorSubject<number> = new BehaviorSubject<number>(100);
  private activeTransition?: CancellableTask;

  get brightness(): number {
    return this._brightness.value;
  }

  public readonly brightnessStream: Observable<number> = this._brightness.asObservable();

  constructor(private openvr: OpenVRService) {
    this.driver.next(new ValveIndexBrightnessControlDriver(openvr));
  }

  async init() {
    this.openvr.devices
      .pipe(
        startWith([]),
        pairwise(),
        filter(([oldDevices, newDevices]) => {
          const oldHMD = oldDevices.find((d) => d.class === 'HMD');
          const newHMD = newDevices.find((d) => d.class === 'HMD');
          return !isEqual(oldHMD, newHMD);
        })
      )
      .subscribe(async () => {
        await this.fetchBrightness();
      });
  }

  async transitionBrightness(
    percentage: number,
    duration: number,
    reason: 'DIRECT' | 'BRIGHTNESS_AUTOMATION'
  ) {
    if (this.activeTransition) {
      this.activeTransition.cancel();
    }
    this.activeTransition = createBrightnessTransitionTask(this, percentage, duration);
    this.activeTransition.onComplete.subscribe(() => {
      if (this.activeTransition?.isComplete()) this.activeTransition = undefined;
    });
    await info(`[BrightnessControl] Starting display brightness transition (${reason})`);
    await this.activeTransition.start();
  }

  async setBrightness(percentage: number, reason: 'DIRECT' | 'BRIGHTNESS_AUTOMATION') {
    if (!(await firstValueFrom(this.driverIsAvailable()))) throw 'DRIVER_UNAVAILABLE';
    if (percentage == this.brightness) return;
    this._brightness.next(percentage);
    await this.driver.value!.setBrightnessPercentage(percentage);
    switch (reason) {
      case 'DIRECT':
        await info(`[BrightnessControl] Set display brightness to ${percentage}% (${reason})`);
        break;
      case 'BRIGHTNESS_AUTOMATION':
        // Would log too often. Automations log by themselves instead.
        break;
    }
  }

  driverIsAvailable(): Observable<boolean> {
    return this.driver.pipe(switchMap((driver) => driver?.isAvailable() ?? of(false)));
  }

  async fetchBrightness(): Promise<number | undefined> {
    if (!(await firstValueFrom(this.driverIsAvailable()))) throw 'DRIVER_UNAVAILABLE';
    const brightness = (await this.driver.value?.getBrightnessPercentage()) ?? undefined;
    if (brightness !== undefined) {
      this._brightness.next(brightness);
      await info(`[BrightnessControl] Fetched display brightness from SteamVR (${brightness}%)`);
    }
    return brightness;
  }

  async getBrightnessBounds(): Promise<[number, number]> {
    if (!(await firstValueFrom(this.driverIsAvailable()))) throw 'DRIVER_UNAVAILABLE';
    return this.driver.value!.getBrightnessBounds();
  }
}
