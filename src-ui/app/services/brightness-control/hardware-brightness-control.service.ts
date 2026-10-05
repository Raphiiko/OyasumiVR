import { Injectable } from '@angular/core';
import {
  HardwareBrightnessControlDriver,
  HardwareBrightnessFade,
  HardwareBrightnessFadeOptions,
} from './hardware-brightness-drivers/hardware-brightness-control-driver';
import { ValveIndexHardwareBrightnessControlDriver } from './hardware-brightness-drivers/valve-index-hardware-brightness-control-driver';
import { OpenVRService } from '../openvr.service';
import {
  BehaviorSubject,
  combineLatest,
  delay,
  distinctUntilChanged,
  EMPTY,
  filter,
  take,
  firstValueFrom,
  map,
  Observable,
  of,
  shareReplay,
  startWith,
  ReplaySubject,
  switchMap,
} from 'rxjs';
import { isEqual } from 'lodash';
import { info, warn } from '@tauri-apps/plugin-log';
import { CancellableTask } from '../../utils/cancellable-task';
import { BrightnessTransitionTask } from './brightness-transition';
import {
  SET_BRIGHTNESS_OR_CCT_OPTIONS_DEFAULTS,
  SetBrightnessOrCCTOptions,
  SetBrightnessOrCCTReason,
} from './brightness-control-models';
import { listen } from '@tauri-apps/api/event';
import { BigscreenBeyondHardwareBrightnessControlDriver } from './hardware-brightness-drivers/bigscreen-beyond-hardware-brightness-control-driver';
import { AppSettingsService } from '../app-settings.service';
import { AppSettings } from '../../models/settings';
import { clamp } from '../../utils/number-utils';
import { SteamFrameHardwareBrightnessControlDriver } from './hardware-brightness-drivers/steam-frame-hardware-brightness-control-driver';
import { SteamFramePairingService } from '../steam-frame/steam-frame-pairing.service';
import { DeviceFade } from '../../utils/device-fade';

/** A transition on the PC, or a fade the device runs. */
export type HardwareBrightnessTransition = CancellableTask & { readonly targetBrightness: number };

export interface AdoptedBrightness {
  percentage: number;
  bounds: [number, number];
}

@Injectable({
  providedIn: 'root',
})
export class HardwareBrightnessControlService {
  public readonly driverValveIndex: ValveIndexHardwareBrightnessControlDriver;
  public readonly driverBigscreenBeyond: BigscreenBeyondHardwareBrightnessControlDriver;
  public readonly driverSteamFrame: SteamFrameHardwareBrightnessControlDriver;
  /** The driver that matched last; it stays set after that driver stops matching. */
  public lastActiveDriver: HardwareBrightnessControlDriver | null = null;

  /** The driver for the active HMD; null while none matches. */
  get activeDriver(): HardwareBrightnessControlDriver | null {
    return this.driver.value;
  }

  private driver: BehaviorSubject<HardwareBrightnessControlDriver | null> =
    new BehaviorSubject<HardwareBrightnessControlDriver | null>(null);
  private _brightness: BehaviorSubject<number> = new BehaviorSubject<number>(100);
  /** The driver the cached brightness came from; another driver's device can hold any value. */
  private brightnessDriver: HardwareBrightnessControlDriver | null = null;
  /** Bumped by every set and transition, so a waiting handoff target yields to a newer request. */
  private _requestGeneration = 0;
  private _activeTransition = new BehaviorSubject<HardwareBrightnessTransition | undefined>(
    undefined
  );
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
  /** Replays the latest value to services that subscribe after the driver reported it. */
  private _adoptedBrightness = new ReplaySubject<AdoptedBrightness>(1);
  /**
   * Values the active driver read from the device, which the cache took without a write. Each
   * carries the driver's bounds at that moment, which `brightnessBounds` may not reflect yet.
   */
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
      steamFrames.connections$,
      steamFrames.fadeEnded$
    );
    const driverList = [this.driverValveIndex, this.driverSteamFrame, this.driverBigscreenBeyond];
    combineLatest(driverList.map((driver) => driver.matches()))
      .pipe(distinctUntilChanged((a, b) => isEqual(a, b)))
      .subscribe((matches) => {
        const matchingDriver = driverList.find((_, i) => matches[i]);
        if (matchingDriver) this.lastActiveDriver = matchingDriver;
        this.driver.next(matchingDriver ?? null);
      });
    // show what the device reports, without writing it back
    this.driver
      .pipe(
        switchMap((driver) =>
          (driver?.brightnessUpdates ?? EMPTY).pipe(
            map((percentage) => ({ percentage, bounds: driver!.getBrightnessBounds(), driver }))
          )
        )
      )
      .subscribe(({ driver, ...adopted }) => {
        this.brightnessDriver = driver;
        this._brightness.next(adopted.percentage);
        this._adoptedBrightness.next(adopted);
      });
    // a pushing driver's bounds can change with each pushed value
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
        // a pushing driver supplies its value itself, and a fetch would hide a pending request;
        // it can take over during the delay, so check the driver that is active now
        switchMap(() =>
          this.driver.value?.pushesBrightnessChanges ? EMPTY : this.fetchBrightness()
        )
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
      // a pushing device can hold a value the cache shows clamped, so it still gets the write
      const write = this.driver.value?.pushesBrightnessChanges
        ? () =>
            this.setBrightness(percentage, {
              cancelActiveTransition: true,
              logReason: opt.logReason,
            })
        : undefined;
      const task = new CancellableTask(write);
      task.start();
      return task;
    }
    const fade = this.deviceFade({
      target: percentage,
      durationMs: duration,
      shownTarget: percentage,
    });
    if (fade) {
      this.cancelActiveTransition();
      return this.activate(fade, opt.logReason);
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
    return this.activate(transition, opt.logReason);
  }

  /** A fade the active device runs itself, or null when it cannot run one now. */
  deviceFade(options: HardwareBrightnessFadeOptions): HardwareBrightnessFade | null {
    return this.driver.value?.fade(options) ?? null;
  }

  /** Makes the transition the active one until it ends, and starts it. */
  private activate(
    transition: HardwareBrightnessTransition,
    logReason: SetBrightnessOrCCTReason | null
  ): HardwareBrightnessTransition {
    const clear = () => {
      if (this._activeTransition.value === transition) this._activeTransition.next(undefined);
    };
    transition.onComplete.subscribe(() => transition.isComplete() && clear());
    transition.onError.subscribe(() => transition.isError() && clear());
    if (transition instanceof DeviceFade) {
      // a device fade cancels itself on an end other than completed
      transition.onCancelled.subscribe(() => {
        clear();
        if (transition.end === 'deviceGone') this.handOff(transition.targetBrightness);
      });
      // runs with the error status, so no newer request can start in between
      transition.onError.subscribe((error) => this.onFadeRefused(transition, error));
    }
    if (logReason) {
      info(`[BrightnessControl] Starting hardware brightness transition (Reason: ${logReason})`);
    }
    this._requestGeneration++;
    this._activeTransition.next(transition);
    const started = transition.start();
    if (transition instanceof DeviceFade) started.catch(() => {});
    return transition;
  }

  /** Sets the target in one command instead. */
  private onFadeRefused(fade: HardwareBrightnessTransition, error: unknown) {
    warn(`[BrightnessControl] The headset refused a brightness fade: ${error}`);
    this.setBrightness(fade.targetBrightness, { cancelActiveTransition: false });
  }

  /** Sets the target of a fade another headset ended, once a driver matches the next headset. */
  private handOff(target: number) {
    const generation = this._requestGeneration;
    this.driver.pipe(filter(Boolean), take(1)).subscribe(() => {
      // a newer set or transition meanwhile wins over the old target
      if (generation === this._requestGeneration) this.setBrightness(target);
    });
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
    this._requestGeneration++;
    const driver = await firstValueFrom(this.driver);
    if (!driver) return;
    if (opt.cancelActiveTransition) this.cancelActiveTransition();
    // a pushing device can hold a value the cache shows clamped, so it always gets the write
    if (
      !force &&
      percentage == this.brightness &&
      driver === this.brightnessDriver &&
      !driver.pushesBrightnessChanges
    ) {
      return;
    }
    this.brightnessDriver = driver;
    this._brightness.next(percentage);
    await driver.setBrightnessPercentage(percentage);
    if (opt.logReason) {
      await info(
        `[BrightnessControl] Set hardware brightness to ${percentage}% (Reason: ${opt.logReason})`
      );
    }
  }

  async fetchBrightness(): Promise<number | undefined> {
    const driver = this.driver.value;
    const brightness = (await driver?.getBrightnessPercentage()) ?? undefined;
    if (brightness !== undefined) {
      this.brightnessDriver = driver;
      this._brightness.next(brightness);
      await info(`[BrightnessControl] Fetched hardware brightness (${brightness}%)`);
    }
    return brightness;
  }

  private async initializeSafetyChecks() {
    this.brightnessBounds.subscribe((bounds) => {
      if (this.driver.value?.pushesBrightnessChanges) return;
      const clamped = clamp(this.brightness, bounds[0], bounds[1]);
      if (clamped !== this.brightness) this.setBrightness(clamped);
    });
  }
}
