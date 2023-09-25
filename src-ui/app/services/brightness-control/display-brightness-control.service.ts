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
import { BrightnessTransitionTask } from './brightness-transition';
import { SET_BRIGHTNESS_OPTIONS_DEFAULTS, SetBrightnessOptions } from './brightness-control-models';

@Injectable({
  providedIn: 'root',
})
export class DisplayBrightnessControlService {
  private driver: BehaviorSubject<DisplayBrightnessControlDriver | null> =
    new BehaviorSubject<DisplayBrightnessControlDriver | null>(null);
  private _brightness: BehaviorSubject<number> = new BehaviorSubject<number>(100);
  private _activeTransition = new BehaviorSubject<BrightnessTransitionTask | undefined>(undefined);
  public readonly activeTransition = this._activeTransition.asObservable();
  public readonly onDriverChange: Observable<void> = this.driver.pipe(
    distinctUntilChanged(),
    map(() => void 0)
  );
  public readonly driverIsAvailable = this.driver.pipe(
    switchMap((driver) => driver?.isAvailable() ?? of(false))
  );

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
    options: Partial<SetBrightnessOptions> = SET_BRIGHTNESS_OPTIONS_DEFAULTS
  ): CancellableTask {
    const opt = { ...SET_BRIGHTNESS_OPTIONS_DEFAULTS, ...(options ?? {}) };
    if (this._brightness.value === percentage) {
      const task = new CancellableTask();
      task.start();
      return task;
    }
    this._activeTransition.value?.cancel();
    const transition = new BrightnessTransitionTask(
      'DISPLAY',
      this.setBrightness.bind(this),
      this.fetchBrightness.bind(this),
      this.getBrightnessBounds.bind(this),
      percentage,
      duration,
      { logReason: opt.logReason }
    );
    transition.onComplete.subscribe(() => {
      if (transition.isComplete() && this._activeTransition.value === transition)
        this._activeTransition.next(undefined);
    });
    transition.onError.subscribe(() => {
      if (transition.isError() && this._activeTransition.value === transition)
        this._activeTransition.next(undefined);
    });
    if (opt.logReason) {
      info(`[BrightnessControl] Starting display brightness transition (Reason: ${opt.logReason})`);
    }
    this._activeTransition.next(transition);
    transition.start();
    return transition;
  }

  cancelActiveTransition() {
    if (this._activeTransition.value) {
      this._activeTransition.value.cancel();
      this._activeTransition.next(undefined);
    }
  }

  async setBrightness(
    percentage: number,
    options: Partial<SetBrightnessOptions> = SET_BRIGHTNESS_OPTIONS_DEFAULTS
  ) {
    const opt = { ...SET_BRIGHTNESS_OPTIONS_DEFAULTS, ...(options ?? {}) };
    if (!(await firstValueFrom(this.driverIsAvailable))) {
      console.trace();
      throw 'DRIVER_UNAVAILABLE';
    }
    if (opt.cancelActiveTransition) this.cancelActiveTransition();
    if (percentage == this.brightness) return;
    this._brightness.next(percentage);
    await this.driver.value!.setBrightnessPercentage(percentage);
    if (opt.logReason) {
      await info(
        `[BrightnessControl] Set display brightness to ${percentage}% (Reason: ${opt.logReason})`
      );
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
