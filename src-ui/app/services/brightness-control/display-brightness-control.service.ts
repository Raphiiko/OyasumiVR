import { Injectable } from '@angular/core';
import { DisplayBrightnessControlDriver } from './display-brightness-drivers/display-brightness-control-driver';
import { ValveIndexDisplayBrightnessControlDriver } from './display-brightness-drivers/valve-index-display-brightness-control-driver';
import { OpenVRService } from '../openvr.service';
import {
  BehaviorSubject,
  distinctUntilChanged,
  filter,
  firstValueFrom,
  map,
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
export class DisplayBrightnessControlService {
  private driver: BehaviorSubject<DisplayBrightnessControlDriver | null> =
    new BehaviorSubject<DisplayBrightnessControlDriver | null>(null);
  private _brightness: BehaviorSubject<number> = new BehaviorSubject<number>(100);
  private _activeTransition?: CancellableTask;
  public readonly onDriverChange: Observable<void> = this.driver.pipe(
    distinctUntilChanged(),
    map(() => void 0)
  );
  public readonly driverIsAvailable = this.driver.pipe(
    switchMap((driver) => driver?.isAvailable() ?? of(false))
  );

  public get activeTransition() {
    return this._activeTransition;
  }

  get brightness(): number {
    return this._brightness.value;
  }

  public readonly brightnessStream: Observable<number> = this._brightness.asObservable();

  constructor(private openvr: OpenVRService) {
    this.driver.next(new ValveIndexDisplayBrightnessControlDriver(openvr));
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

  transitionBrightness(
    percentage: number,
    duration: number,
    reason: 'DIRECT' | 'INDIRECT'
  ): CancellableTask {
    this._activeTransition?.cancel();
    this._activeTransition = createBrightnessTransitionTask(
      'DISPLAY',
      this.setBrightness.bind(this),
      this.fetchBrightness.bind(this),
      this.getBrightnessBounds.bind(this),
      percentage,
      duration
    );
    this._activeTransition.onComplete.subscribe(() => {
      if (this._activeTransition?.isComplete()) this._activeTransition = undefined;
    });
    this._activeTransition.onError.subscribe(() => {
      if (this._activeTransition?.isError()) this._activeTransition = undefined;
    });
    info(`[BrightnessControl] Starting display brightness transition (${reason})`);
    this._activeTransition.start();
    return this._activeTransition;
  }

  cancelActiveTransition() {
    this._activeTransition?.cancel();
    this._activeTransition = undefined;
  }

  async setBrightness(percentage: number, reason: 'DIRECT' | 'INDIRECT') {
    if (!(await firstValueFrom(this.driverIsAvailable))) throw 'DRIVER_UNAVAILABLE';
    if (reason === 'DIRECT') this.cancelActiveTransition();
    if (percentage == this.brightness) return;
    this._brightness.next(percentage);
    await this.driver.value!.setBrightnessPercentage(percentage);
    switch (reason) {
      case 'DIRECT':
        await info(`[BrightnessControl] Set display brightness to ${percentage}% (${reason})`);
        break;
      case 'INDIRECT':
        // Logs are made by whatever triggered the brightness change.
        break;
    }
  }

  async fetchBrightness(): Promise<number | undefined> {
    if (!(await firstValueFrom(this.driverIsAvailable))) throw 'DRIVER_UNAVAILABLE';
    const brightness = (await this.driver.value?.getBrightnessPercentage()) ?? undefined;
    if (brightness !== undefined) {
      this._brightness.next(brightness);
      await info(`[BrightnessControl] Fetched display brightness from SteamVR (${brightness}%)`);
    }
    return brightness;
  }

  async getBrightnessBounds(): Promise<[number, number]> {
    // For now this check is not needed, but it might be in the future.
    // if (!(await firstValueFrom(this.driverIsAvailable()))) throw 'DRIVER_UNAVAILABLE';
    return this.driver.value!.getBrightnessBounds();
  }
}