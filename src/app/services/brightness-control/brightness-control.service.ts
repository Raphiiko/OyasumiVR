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

@Injectable({
  providedIn: 'root',
})
export class BrightnessControlService {
  private driver: BehaviorSubject<BrightnessControlDriver | null> =
    new BehaviorSubject<BrightnessControlDriver | null>(null);
  private _brightness: BehaviorSubject<number> = new BehaviorSubject<number>(
    100
  );
  get brightness(): number {
    return this._brightness.value;
  }

  public readonly brightnessStream: Observable<number> =
    this._brightness.asObservable();

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

  async setBrightness(
    percentage: number,
    reason: 'DIRECT' | 'OSC_CONTROL' | 'HTTP_CONTROL'
  ) {
    if (!(await firstValueFrom(this.driverIsAvailable())))
      throw 'DRIVER_UNAVAILABLE';
    if (percentage == this.brightness) return;
    this._brightness.next(percentage);
    await this.driver.value!.setBrightnessPercentage(percentage);
  }

  driverIsAvailable(): Observable<boolean> {
    return this.driver.pipe(
      switchMap((driver) => driver?.isAvailable() ?? of(false))
    );
  }

  async fetchBrightness(): Promise<number | undefined> {
    if (!(await firstValueFrom(this.driverIsAvailable())))
      throw 'DRIVER_UNAVAILABLE';
    const brightness =
      (await this.driver.value?.getBrightnessPercentage()) ?? undefined;
    if (brightness !== undefined) this._brightness.next(brightness);
    return brightness;
  }

  async getBrightnessBounds(): Promise<[number, number]> {
    if (!(await firstValueFrom(this.driverIsAvailable())))
      throw 'DRIVER_UNAVAILABLE';
    return this.driver.value!.getBrightnessBounds();
  }
}
