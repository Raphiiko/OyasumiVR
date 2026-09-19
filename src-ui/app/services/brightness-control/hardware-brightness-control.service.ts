import { toObservable } from '@angular/core/rxjs-interop';
import { FramePairingService } from '../frame-pairing.service';
import { SteamFrameHardwareBrightnessControlDriver } from './hardware-brightness-drivers/steam-frame-hardware-brightness-control-driver';
import { Injectable, OnDestroy } from '@angular/core';
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
  Subscription,
  switchMap,
} from 'rxjs';
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
import { clamp } from '../../utils/number-utils';

@Injectable({
  providedIn: 'root',
})
export class HardwareBrightnessControlService implements OnDestroy {
  private readonly subscriptions = new Subscription();
  public readonly driverSteamFrame: SteamFrameHardwareBrightnessControlDriver;
  public readonly driverValveIndex: ValveIndexHardwareBrightnessControlDriver;
  public readonly driverBigscreenBeyond: BigscreenBeyondHardwareBrightnessControlDriver;

  private driver: BehaviorSubject<HardwareBrightnessControlDriver | null> =
    new BehaviorSubject<HardwareBrightnessControlDriver | null>(null);
  private commandGeneration = 0;
  private _brightness: BehaviorSubject<number> = new BehaviorSubject<number>(100);
  private _activeTransition = new BehaviorSubject<
    (CancellableTask & { targetBrightness: number }) | undefined
  >(undefined);
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
    private appSettingsService: AppSettingsService,
    framePairing: FramePairingService
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
      toObservable(framePairing.states),
      openvr
    );
    void framePairing.init();
    this.subscriptions.add(
      this.driverSteamFrame.appliedBrightness.subscribe((value) => this._brightness.next(value))
    );
    const driverList = [this.driverValveIndex, this.driverBigscreenBeyond, this.driverSteamFrame];
    this.subscriptions.add(
      combineLatest([
        combineLatest(driverList.map((driver) => driver.isAvailable())),
        this.driverSteamFrame.snapshot,
      ])
        .pipe(
          map(([available, frame]) =>
            frame
              ? available[2]
                ? this.driverSteamFrame
                : null
              : (driverList.find((_, i) => available[i]) ?? null)
          ),
          distinctUntilChanged()
        )
        .subscribe((driver) => this.driver.next(driver))
    );
    this.brightnessBounds = combineLatest([
      this.driver,
      this.appSettingsService.settings,
      this.driverSteamFrame.snapshot,
    ]).pipe(
      map(([driver, settings]) => {
        if (!driver)
          return this.hasFrameCompanion
            ? this.driverSteamFrame.getBrightnessBounds()
            : ([0, 100] as [number, number]);
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
        switchMap(() => this.fetchBrightness().catch(() => undefined))
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
    if (this._brightness.value === percentage && !this.delegatesTransitions) {
      const task = new CancellableTask();
      task.start();
      return task;
    }
    this._activeTransition.value?.cancel();
    if (this.delegatesTransitions) {
      return this.delegateTransition(percentage, duration)!;
    }
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
    const generation = ++this.commandGeneration;
    const driver = this.driver.value ?? (this.hasFrameCompanion ? this.driverSteamFrame : null);
    if (!driver) return;
    if (opt.cancelActiveTransition) this.cancelActiveTransition();
    if (!force && percentage == this.brightness && driver !== this.driverSteamFrame) return;
    await driver.setBrightnessPercentage(percentage);
    if (driver !== this.driverSteamFrame && generation === this.commandGeneration)
      this._brightness.next(percentage);
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

  get hasFrameCompanion(): boolean {
    return !!this.driverSteamFrame.snapshot.value?.brightness;
  }

  get delegatesTransitions(): boolean {
    return !!this.driver.value?.transitionBrightness || this.hasFrameCompanion;
  }

  delegateTransition(
    percentage: number,
    duration: number,
    simple?: { from: number; to: number },
    progress?: (fraction: number) => Promise<void>
  ): CancellableTask | undefined {
    const driver = this.driver.value ?? (this.hasFrameCompanion ? this.driverSteamFrame : null);
    const transition = driver?.transitionBrightness?.(percentage, duration, simple, progress);
    if (!transition) return undefined;
    this._activeTransition.value?.cancel();
    this._activeTransition.next(Object.assign(transition, { targetBrightness: percentage }));
    const clear = () => {
      if (this._activeTransition.value === transition) this._activeTransition.next(undefined);
    };
    transition.onComplete.subscribe(clear);
    transition.onCancelled.subscribe(clear);
    transition.onError.subscribe(clear);
    void transition.start().catch(() => {});
    return transition;
  }

  ngOnDestroy() {
    this.subscriptions.unsubscribe();
    this.cancelActiveTransition();
    this.driverSteamFrame.dispose();
    this.driverValveIndex.dispose();
    this.driverBigscreenBeyond.dispose();
  }

  private async initializeSafetyChecks() {
    this.brightnessBounds.subscribe((bounds) => {
      const clamped = clamp(this.brightness, bounds[0], bounds[1]);
      if (clamped !== this.brightness && !this.hasFrameCompanion) this.setBrightness(clamped);
    });
  }
}
