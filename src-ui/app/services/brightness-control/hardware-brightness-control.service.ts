import { Injectable } from '@angular/core';
import { HardwareBrightnessControlDriver } from './hardware-brightness-drivers/hardware-brightness-control-driver';
import { ValveIndexHardwareBrightnessControlDriver } from './hardware-brightness-drivers/valve-index-hardware-brightness-control-driver';
import { OpenVRService } from '../openvr.service';
import {
  BehaviorSubject,
  combineLatest,
  delay,
  distinctUntilChanged,
  filter,
  firstValueFrom,
  map,
  Observable,
  of,
  shareReplay,
  switchMap,
} from 'rxjs';
import { isEqual } from 'lodash';
import { info } from 'tauri-plugin-log-api';
import { CancellableTask } from '../../utils/cancellable-task';
import { BrightnessTransitionTask } from './brightness-transition';
import { SET_BRIGHTNESS_OPTIONS_DEFAULTS, SetBrightnessOptions } from './brightness-control-models';
import { listen } from '@tauri-apps/api/event';
import { BigscreenBeyondHardwareBrightnessControlDriver } from './hardware-brightness-drivers/bigscreen-beyond-hardware-brightness-control-driver';
import { AppSettingsService } from '../app-settings.service';
import { AppSettings } from '../../models/settings';
import { clamp } from '../../utils/number-utils';

@Injectable({
  providedIn: 'root',
})
export class HardwareBrightnessControlService {
  public readonly driverValveIndex: ValveIndexHardwareBrightnessControlDriver;
  public readonly driverBigscreenBeyond: BigscreenBeyondHardwareBrightnessControlDriver;

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
    switchMap((driver) => driver?.isAvailable() ?? of(false)),
    distinctUntilChanged(),
    shareReplay(1)
  );
  public readonly brightnessBounds: Observable<[number, number]>;

  get brightness(): number {
    return this._brightness.value;
  }

  public readonly brightnessStream: Observable<number> = this._brightness.asObservable();

  constructor(
    openvr: OpenVRService,
    private appSettingsService: AppSettingsService // private bsbFanAutomationService: BigscreenBeyondFanAutomationService
  ) {
    this.driverValveIndex = new ValveIndexHardwareBrightnessControlDriver(
      this.appSettingsService.settings,
      openvr
    );
    this.driverBigscreenBeyond = new BigscreenBeyondHardwareBrightnessControlDriver(
      this.appSettingsService.settings
    );
    const driverList = [this.driverValveIndex, this.driverBigscreenBeyond];
    combineLatest(driverList.map((driver) => driver.isAvailable()))
      .pipe(distinctUntilChanged((a, b) => isEqual(a, b)))
      .subscribe((drivers) => {
        const availableDriver = driverList.find((_, i) => drivers[i]);
        this.driver.next(availableDriver ?? null);
      });
    this.brightnessBounds = combineLatest([this.driver, this.appSettingsService.settings]).pipe(
      map(([driver, settings]: [HardwareBrightnessControlDriver | null, AppSettings]) => {
        if (!driver) return [0, 100] as [number, number];
        return driver.getBrightnessBounds(settings);
      }),
      distinctUntilChanged((a, b) => a[0] === b[0] && a[1] === b[1]),
      shareReplay(1)
    );
  }

  async init() {
    this.driver
      .pipe(
        distinctUntilChanged(),
        filter(Boolean),
        switchMap((driver) => driver.isAvailable()),
        distinctUntilChanged(),
        filter(Boolean),
        delay(500),
        switchMap(() => this.fetchBrightness())
      )
      .subscribe();
    await listen<number>('setHardwareBrightness', async (event) => {
      await this.setBrightness(event.payload, { cancelActiveTransition: true });
    });
    await this.initializeSafetyChecks();
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
      () => firstValueFrom(this.brightnessBounds),
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
    options: Partial<SetBrightnessOptions> = SET_BRIGHTNESS_OPTIONS_DEFAULTS,
    force = false
  ) {
    const opt = { ...SET_BRIGHTNESS_OPTIONS_DEFAULTS, ...(options ?? {}) };
    if (!(await firstValueFrom(this.driverIsAvailable))) return;
    if (opt.cancelActiveTransition) this.cancelActiveTransition();
    if (!force && percentage == this.brightness) return;
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
      await info(`[BrightnessControl] Fetched hardware brightness (${brightness}%)`);
    }
    return brightness;
  }

  private async initializeSafetyChecks() {
    this.brightnessBounds.subscribe((bounds) => {
      const clamped = clamp(this.brightness, bounds[0], bounds[1]);
      if (clamped !== this.brightness) this.setBrightness(clamped);
    });
  }
}
