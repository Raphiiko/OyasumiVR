import { Injectable } from '@angular/core';
import {
  HardwareBrightnessControlDriver,
  HardwareBrightnessControlDriverBounds,
} from './hardware-brightness-drivers/hardware-brightness-control-driver';
import { ValveIndexHardwareBrightnessControlDriver } from './hardware-brightness-drivers/valve-index-hardware-brightness-control-driver';
import { OpenVRService } from '../openvr.service';
import {
  BehaviorSubject,
  combineLatest,
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
import { listen } from '@tauri-apps/api/event';
import { BigscreenBeyondHardwareBrightnessControlDriver } from './hardware-brightness-drivers/bigscreen-beyond-hardware-brightness-control-driver';

@Injectable({
  providedIn: 'root',
})
export class HardwareBrightnessControlService {
  private readonly driverValveIndex: ValveIndexHardwareBrightnessControlDriver;
  private readonly driverBigscreenBeyond: BigscreenBeyondHardwareBrightnessControlDriver;

  private driver: BehaviorSubject<HardwareBrightnessControlDriver | null> =
    new BehaviorSubject<HardwareBrightnessControlDriver | null>(null);
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
    this.driverValveIndex = new ValveIndexHardwareBrightnessControlDriver(openvr);
    this.driverBigscreenBeyond = new BigscreenBeyondHardwareBrightnessControlDriver(openvr);
    const driverList = [this.driverValveIndex, this.driverBigscreenBeyond];
    combineLatest(driverList.map((driver) => driver.isAvailable()))
      .pipe(distinctUntilChanged((a, b) => isEqual(a, b)))
      .subscribe((drivers) => {
        const availableDriver = driverList.find((_, i) => drivers[i]);
        this.driver.next(availableDriver ?? null);
      });
  }

  async init() {
    this.openvr.devices
      .pipe(
        startWith([]),
        pairwise(),
        filter(([oldDevices, newDevices]) => {
          const oldHMD = oldDevices.find((d) => d.class === 'HMD');
          const newHMD = newDevices.find((d) => d.class === 'HMD');
          return !isEqual(oldHMD, newHMD) && !!newHMD;
        })
      )
      .subscribe(async () => {
        await this.fetchBrightness();
      });
    await listen<number>('setHardwareBrightness', async (event) => {
      await this.setBrightness(event.payload, { cancelActiveTransition: true });
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
      'HARDWARE',
      this.setBrightness.bind(this),
      this.fetchBrightness.bind(this),
      async () => {
        const bounds = await this.getBrightnessBounds();
        return [bounds.softwareStops[0], bounds.softwareStops[bounds.softwareStops.length - 1]];
      },
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
      info(
        `[BrightnessControl] Starting hardware brightness transition (Reason: ${opt.logReason})`
      );
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
    if (!(await firstValueFrom(this.driverIsAvailable))) return;
    if (opt.cancelActiveTransition) this.cancelActiveTransition();
    if (percentage == this.brightness) return;
    this._brightness.next(percentage);
    await this.driver.value!.setBrightnessPercentage(percentage);
    if (opt.logReason) {
      await info(
        `[BrightnessControl] Set hardware brightness to ${percentage}% (Reason: ${opt.logReason})`
      );
    }
  }

  async fetchBrightness(): Promise<number | undefined> {
    const brightness = (await this.driver.value?.getBrightnessPercentage()) ?? undefined;
    if (brightness !== undefined) {
      this._brightness.next(brightness);
      await info(`[BrightnessControl] Fetched hardware brightness from SteamVR (${brightness}%)`);
    }
    return brightness;
  }

  async getBrightnessBounds(): Promise<HardwareBrightnessControlDriverBounds> {
    if (!this.driver.value)
      return {
        softwareStops: [0, 100],
        hardwareStops: [0, 100],
        overdriveThreshold: 100,
        riskThreshold: 100,
      };
    return this.driver.value!.getBrightnessBounds();
  }
}
