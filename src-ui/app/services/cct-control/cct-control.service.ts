import { Injectable } from '@angular/core';
import {
  BehaviorSubject,
  combineLatest,
  debounceTime,
  distinctUntilChanged,
  EMPTY,
  filter,
  map,
  Observable,
  of,
  shareReplay,
  switchMap,
} from 'rxjs';
import { isEqual } from 'lodash';
import { CCTTransitionTask } from './cct-transition';
import { DeviceFade } from '../../utils/device-fade';
import { listen } from '@tauri-apps/api/event';
import {
  SET_BRIGHTNESS_OR_CCT_OPTIONS_DEFAULTS,
  SetBrightnessOrCCTOptions,
  SetBrightnessOrCCTReason,
} from '../brightness-control/brightness-control-models';
import { CancellableTask } from '../../utils/cancellable-task';
import { info, warn } from '@tauri-apps/plugin-log';
import { getCSSColorForCCT } from 'src-shared-ts/src/cct-utils';
import { OpenVRService } from '../openvr.service';
import { clamp } from '../../utils/number-utils';
import { AppSettingsService } from '../app-settings.service';
import { CctControlDriver, CctFade } from './cct-control-drivers/cct-control-driver';
import { SteamVrCctControlDriver } from './cct-control-drivers/steamvr-cct-control-driver';
import { SteamFrameCctControlDriver } from './cct-control-drivers/steam-frame-cct-control-driver';
import { SteamFramePairingService } from '../steam-frame/steam-frame-pairing.service';

/** A transition on the PC, or a fade the device runs. */
type CctTransition = CancellableTask & { readonly targetCCT: number };

/** Gives SteamVR color gains of exactly 1.0 on every channel. */
const NEUTRAL_CCT = 6600;

@Injectable({
  providedIn: 'root',
})
export class CCTControlService {
  private _cct: BehaviorSubject<number> = new BehaviorSubject<number>(6600);
  private _activeTransition = new BehaviorSubject<CctTransition | undefined>(undefined);
  public readonly driverSteamVr: SteamVrCctControlDriver;
  public readonly driverSteamFrame: SteamFrameCctControlDriver;
  /** The driver that matches the active HMD; null while none does. */
  public readonly activeDriver: Observable<CctControlDriver | null>;
  public readonly driverIsAvailable: Observable<boolean>;
  private driver: CctControlDriver | null = null;
  public readonly activeTransition = this._activeTransition.asObservable();
  public cctCSSColor: string = 'white';

  get cct(): number {
    return this._cct.value;
  }

  public readonly cctStream: Observable<number> = this._cct.asObservable();

  constructor(
    private openvr: OpenVRService,
    appSettingsService: AppSettingsService,
    steamFrames: SteamFramePairingService
  ) {
    this.driverSteamVr = new SteamVrCctControlDriver(openvr, appSettingsService.settings);
    this.driverSteamFrame = new SteamFrameCctControlDriver(openvr, steamFrames);
    // the SteamVR driver can match any headset, so it stays last
    const drivers: CctControlDriver[] = [this.driverSteamFrame, this.driverSteamVr];
    this.activeDriver = combineLatest(drivers.map((driver) => driver.matches())).pipe(
      map((matches) => drivers.find((_, i) => matches[i]) ?? null),
      distinctUntilChanged(),
      shareReplay(1)
    );
    this.driverIsAvailable = this.activeDriver.pipe(
      switchMap((driver) => driver?.isAvailable() ?? of(false)),
      distinctUntilChanged(),
      shareReplay(1)
    );
  }

  async init() {
    this.watchDrivers();
    this._cct.pipe(distinctUntilChanged()).subscribe((cct) => {
      this.cctCSSColor = getCSSColorForCCT(cct);
    });
    await listen<number>('setColorTemperature', async (event) => {
      await this.setCCT(event.payload, { cancelActiveTransition: true });
    });
  }

  transitionCCT(
    temperature: number,
    duration: number,
    options: Partial<SetBrightnessOrCCTOptions> = SET_BRIGHTNESS_OR_CCT_OPTIONS_DEFAULTS
  ): CancellableTask {
    const opt = { ...SET_BRIGHTNESS_OR_CCT_OPTIONS_DEFAULTS, ...(options ?? {}) };
    const fade = this.deviceFade(temperature, duration);
    if (fade) {
      this.cancelActiveTransition();
      return this.activate(fade, opt.logReason);
    }
    if (this._cct.value === temperature) {
      this.cancelActiveTransition();
      const task = new CancellableTask();
      task.start();
      return task;
    }
    const transition = new CCTTransitionTask(
      this.setCCT.bind(this),
      async () => this.cct,
      temperature,
      duration,
      { logReason: opt.logReason }
    );
    return this.activate(transition, opt.logReason);
  }

  /** A fade the active device runs itself, or null while no driver takes one. */
  private deviceFade(temperature: number, duration: number): CctFade | null {
    const target = clamp(Math.round(temperature), 1000, 10000);
    return this.driver?.fade({ target, durationMs: duration }) ?? null;
  }

  /** Makes the transition the active one until it ends, and starts it. */
  private activate(
    transition: CctTransition,
    logReason: SetBrightnessOrCCTReason | null
  ): CctTransition {
    const clear = () => {
      if (this._activeTransition.value === transition) this._activeTransition.next(undefined);
    };
    transition.onComplete.subscribe(() => transition.isComplete() && clear());
    transition.onError.subscribe(() => transition.isError() && clear());
    // a device fade cancels itself on an end other than completed
    if (transition instanceof DeviceFade) {
      transition.onCancelled.subscribe(() => {
        clear();
        // another headset gets the target in one command
        if (transition.end === 'deviceGone') this.setCCT(transition.targetCCT);
      });
      // runs with the error status, so no newer request can start in between
      transition.onError.subscribe((error) => this.onFadeRefused(transition, error));
    }
    if (logReason) {
      info(`[CCTControl] Starting CCT transition (Reason: ${logReason})`);
    }
    this._activeTransition.next(transition);
    const started = transition.start();
    if (transition instanceof DeviceFade) started.catch(() => {});
    return transition;
  }

  /** Sets the target in one command instead. */
  private onFadeRefused(fade: CctTransition, error: unknown) {
    warn(`[CCTControl] The headset refused a color temperature fade: ${error}`);
    this.setCCT(fade.targetCCT, { cancelActiveTransition: false });
  }

  cancelActiveTransition() {
    if (this._activeTransition.value) {
      this._activeTransition.value.cancel();
      this._activeTransition.next(undefined);
    }
  }

  async setCCT(
    cct: number,
    options: Partial<SetBrightnessOrCCTOptions> = SET_BRIGHTNESS_OR_CCT_OPTIONS_DEFAULTS,
    force = false
  ) {
    const opt = { ...SET_BRIGHTNESS_OR_CCT_OPTIONS_DEFAULTS, ...(options ?? {}) };
    cct = clamp(Math.round(cct), 1000, 10000);
    if (opt.cancelActiveTransition) this.cancelActiveTransition();
    const driver = this.driver;
    if (driver?.pushesCctChanges) {
      await driver.setCCT(cct);
    } else {
      if (cct === this.cct && !force) return;
      this._cct.next(cct);
      await driver?.setCCT(cct);
    }
    if (opt.logReason) {
      await info(`[CCTControl] Set CCT to ${cct}K (Reason: ${opt.logReason})`);
    }
  }

  /** A fade the previous device ran ends first, so its target reaches the next one. */
  private onDriver(driver: CctControlDriver | null) {
    const previous = this.driver;
    this.driver = driver;
    const transition = this._activeTransition.value;
    if (driver && driver !== previous && transition instanceof DeviceFade) {
      transition.endAsDeviceGone();
    }
  }

  private watchDrivers() {
    this.activeDriver.subscribe((driver) => this.onDriver(driver));

    // show the values a driver pushes, without writing them back
    this.activeDriver
      .pipe(switchMap((driver) => driver?.cctUpdates ?? EMPTY))
      .subscribe((kelvin) => this._cct.next(kelvin));

    // write the app's value once a driver can write it, unless the driver pushes its own
    this.activeDriver
      .pipe(
        switchMap((driver) =>
          driver && !driver.pushesCctChanges ? driver.isAvailable().pipe(filter(Boolean)) : EMPTY
        )
      )
      .subscribe(() => this.setCCT(this.cct, SET_BRIGHTNESS_OR_CCT_OPTIONS_DEFAULTS, true));

    // log which driver serves which headset, once both have settled
    const hmd = this.openvr.devices.pipe(
      map((devices) => devices.find((d) => d.index === 0 && d.class === 'HMD')),
      map((hmd) =>
        hmd
          ? `manufacturer "${hmd.manufacturerName ?? ''}", model "${hmd.modelNumber ?? ''}"`
          : null
      ),
      distinctUntilChanged()
    );
    combineLatest([this.activeDriver, hmd])
      .pipe(debounceTime(500), distinctUntilChanged(isEqual))
      .subscribe(([driver, hmd]) => {
        if (!hmd) return;
        if (driver) {
          info(`[CCTControl] Using the ${driver.name} driver for the HMD with ${hmd}`);
          return;
        }
        info(`[CCTControl] No color temperature driver supports the HMD with ${hmd}`);
        // SteamVR keeps the gains across sessions, so clear a tint an earlier session left
        this.driverSteamVr.setCCT(NEUTRAL_CCT);
      });
  }
}
