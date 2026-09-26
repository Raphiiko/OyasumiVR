import { Injectable } from '@angular/core';
import { HardwareBrightnessControlDriver } from './hardware-brightness-drivers/hardware-brightness-control-driver';
import { ValveIndexHardwareBrightnessControlDriver } from './hardware-brightness-drivers/valve-index-hardware-brightness-control-driver';
import { OpenVRService } from '../openvr.service';
import {
  BehaviorSubject,
  combineLatest,
  delay,
  distinctUntilChanged,
  EMPTY,
  filter,
  firstValueFrom,
  map,
  Observable,
  of,
  shareReplay,
  startWith,
  Subject,
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
import { AppSettingsService } from '../app-settings.service';
import { AppSettings } from '../../models/settings';
import { clamp } from '../../utils/number-utils';
import { SteamFrameHardwareBrightnessControlDriver } from './hardware-brightness-drivers/steam-frame-hardware-brightness-control-driver';
import { SteamFramePairingService } from '../steam-frame-pairing.service';

@Injectable({
  providedIn: 'root',
})
export class HardwareBrightnessControlService {
  public readonly driverValveIndex: ValveIndexHardwareBrightnessControlDriver;
  public readonly driverBigscreenBeyond: BigscreenBeyondHardwareBrightnessControlDriver;
  public readonly driverSteamFrame: SteamFrameHardwareBrightnessControlDriver;
  /** The driver that was available last; it stays set after that driver becomes unavailable. */
  public lastActiveDriver: HardwareBrightnessControlDriver | null = null;

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
  private _adoptedBrightness = new Subject<number>();
  /** Values the active driver read from the device, which the cache took without a write. */
  public readonly adoptedBrightness = this._adoptedBrightness.asObservable();

  get brightness(): number {
    return this._brightness.value;
  }

  public readonly brightnessStream: Observable<number> = this._brightness.asObservable();

  constructor(
    openvr: OpenVRService,
    private appSettingsService: AppSettingsService, // private bsbFanAutomationService: BigscreenBeyondFanAutomationService
    steamFrames: SteamFramePairingService
  ) {
    this.driverValveIndex = new ValveIndexHardwareBrightnessControlDriver(
      this.appSettingsService.settings,
      openvr
    );
    this.driverBigscreenBeyond = new BigscreenBeyondHardwareBrightnessControlDriver(
      this.appSettingsService.settings
    );
    this.driverSteamFrame = new SteamFrameHardwareBrightnessControlDriver(
      this.appSettingsService.settings,
      openvr,
      steamFrames.pairings$,
      steamFrames.connections$
    );
    const driverList = [this.driverValveIndex, this.driverSteamFrame, this.driverBigscreenBeyond];
    combineLatest(driverList.map((driver) => driver.isAvailable()))
      .pipe(distinctUntilChanged((a, b) => isEqual(a, b)))
      .subscribe((drivers) => {
        const availableDriver = driverList.find((_, i) => drivers[i]);
        if (availableDriver) this.lastActiveDriver = availableDriver;
        this.driver.next(availableDriver ?? null);
      });
    // show what the device reports, without writing it back
    this.driver
      .pipe(switchMap((driver) => driver?.brightnessUpdates ?? EMPTY))
      .subscribe((percentage) => {
        this._brightness.next(percentage);
        this._adoptedBrightness.next(percentage);
      });
    // a reporting driver's bounds can change with each report
    const driverBounds = this.driver.pipe(
      switchMap((driver) =>
        (driver?.brightnessUpdates ?? EMPTY).pipe(
          startWith(null),
          map(() => driver)
        )
      )
    );
    this.brightnessBounds = combineLatest([driverBounds, this.appSettingsService.settings]).pipe(
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
    options: Partial<SetBrightnessOrCCTOptions> = SET_BRIGHTNESS_OR_CCT_OPTIONS_DEFAULTS
  ): CancellableTask {
    const opt = { ...SET_BRIGHTNESS_OR_CCT_OPTIONS_DEFAULTS, ...(options ?? {}) };
    if (this._brightness.value === percentage) {
      const task = new CancellableTask();
      task.start();
      return task;
    }
    // no PC loop writes a device that reports its own brightness
    if (this.driver.value?.reportsBrightness) {
      this.cancelActiveTransition();
      const task = new CancellableTask(() =>
        this.setBrightness(percentage, { cancelActiveTransition: false, logReason: opt.logReason })
      );
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
      if (this.driver.value?.reportsBrightness) return;
      const clamped = clamp(this.brightness, bounds[0], bounds[1]);
      if (clamped !== this.brightness) this.setBrightness(clamped);
    });
  }
}
