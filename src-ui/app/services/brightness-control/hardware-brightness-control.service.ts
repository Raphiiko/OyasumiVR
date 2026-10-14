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
import { info } from '@tauri-apps/plugin-log';
import { CancellableTask } from '../../utils/cancellable-task';
import { BrightnessTransitionTask } from './brightness-transition';
import {
  SET_BRIGHTNESS_OR_CCT_OPTIONS_DEFAULTS,
  SetBrightnessOrCCTOptions,
} from './brightness-control-models';
import { listen } from '@tauri-apps/api/event';
import { BigscreenBeyondHardwareBrightnessControlDriver } from './hardware-brightness-drivers/bigscreen-beyond-hardware-brightness-control-driver';
import { PSVR2HardwareBrightnessControlDriver } from './hardware-brightness-drivers/psvr2-hardware-brightness-control-driver';
import { SteamVRAnalogGainHardwareBrightnessControlDriver } from './hardware-brightness-drivers/steamvr-analog-gain-hardware-brightness-control-driver';
import { AppSettingsService } from '../app-settings.service';
import { AppSettings } from '../../models/settings';
import { clamp } from '../../utils/number-utils';

@Injectable({
  providedIn: 'root',
})
export class HardwareBrightnessControlService {
  public readonly driverValveIndex: ValveIndexHardwareBrightnessControlDriver;
  public readonly driverBigscreenBeyond: BigscreenBeyondHardwareBrightnessControlDriver;
  public readonly driverPSVR2: PSVR2HardwareBrightnessControlDriver;
  public readonly driverSteamVRAnalogGain: SteamVRAnalogGainHardwareBrightnessControlDriver;
  /** True while a driver made for the connected headset is available. */
  public readonly headsetDriverIsAvailable: Observable<boolean>;

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
    this.driverPSVR2 = new PSVR2HardwareBrightnessControlDriver(
      this.appSettingsService.settings,
      openvr
    );
    this.driverSteamVRAnalogGain = new SteamVRAnalogGainHardwareBrightnessControlDriver(
      this.appSettingsService.settings,
      openvr
    );
    const headsetDrivers = [this.driverValveIndex, this.driverBigscreenBeyond, this.driverPSVR2];
    this.headsetDriverIsAvailable = combineLatest(
      headsetDrivers.map((driver) => driver.isAvailable())
    ).pipe(
      map((available) => available.some(Boolean)),
      distinctUntilChanged(),
      shareReplay(1)
    );
    // the generic SteamVR analog gain driver only serves headsets that no driver above claims
    const driverList = [...headsetDrivers, this.driverSteamVRAnalogGain];
    combineLatest(driverList.map((driver) => driver.isAvailable()))
      .pipe(distinctUntilChanged((a, b) => isEqual(a, b)))
      .subscribe((drivers) => this.selectDriver(driverList.find((_, i) => drivers[i]) ?? null));
    // the cached percentage maps to a different gain once the range changes, so write it again
    this.driverSteamVRAnalogGain.rangeChanges.subscribe(() => {
      if (this.driver.value !== this.driverSteamVRAnalogGain) return;
      this.setBrightness(this.brightness, { cancelActiveTransition: false, logReason: null }, true);
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

  private selectDriver(driver: HardwareBrightnessControlDriver | null) {
    if (driver === this.driver.value) return;
    // SteamVR keeps the gain, so undo the generic driver's dimming when nothing takes over
    if (
      this.driver.value === this.driverSteamVRAnalogGain &&
      !driver &&
      this.driverSteamVRAnalogGain.restoreMaximumGain()
    ) {
      this._brightness.next(100);
    }
    this.driver.next(driver);
  }

  async init() {
    this.driver
      .pipe(
        distinctUntilChanged(),
        filter(Boolean),
        // read each newly selected driver's level, also when it takes over from another driver
        switchMap((driver) => driver.isAvailable().pipe(distinctUntilChanged())),
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
    options: Partial<SetBrightnessOrCCTOptions> = SET_BRIGHTNESS_OR_CCT_OPTIONS_DEFAULTS
  ): CancellableTask {
    const opt = { ...SET_BRIGHTNESS_OR_CCT_OPTIONS_DEFAULTS, ...(options ?? {}) };
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
    options: Partial<SetBrightnessOrCCTOptions> = SET_BRIGHTNESS_OR_CCT_OPTIONS_DEFAULTS,
    force = false
  ) {
    const opt = { ...SET_BRIGHTNESS_OR_CCT_OPTIONS_DEFAULTS, ...(options ?? {}) };
    const driver = await firstValueFrom(this.driver);
    if (!driver) return;
    if (opt.cancelActiveTransition) this.cancelActiveTransition();
    if (!force && percentage == this.brightness) return;
    this._brightness.next(percentage);
    await driver.setBrightnessPercentage(percentage);
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
