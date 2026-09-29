import { Injectable } from '@angular/core';
import {
  BehaviorSubject,
  combineLatest,
  debounceTime,
  distinctUntilChanged,
  map,
  Observable,
  of,
  pairwise,
  shareReplay,
  startWith,
  switchMap,
} from 'rxjs';
import { isEqual } from 'lodash';
import { CCTTransitionTask } from './cct-transition';
import { listen } from '@tauri-apps/api/event';
import {
  SET_BRIGHTNESS_OR_CCT_OPTIONS_DEFAULTS,
  SetBrightnessOrCCTOptions,
} from '../brightness-control/brightness-control-models';
import { CancellableTask } from '../../utils/cancellable-task';
import { info } from '@tauri-apps/plugin-log';
import { getCSSColorForCCT } from 'src-shared-ts/src/cct-utils';
import { OpenVRService } from '../openvr.service';
import { clamp } from '../../utils/number-utils';
import { AppSettingsService } from '../app-settings.service';
import { CctControlDriver } from './cct-control-drivers/cct-control-driver';
import { SteamVrCctControlDriver } from './cct-control-drivers/steamvr-cct-control-driver';

/** Gives SteamVR color gains of exactly 1.0 on every channel. */
const NEUTRAL_CCT = 6600;

@Injectable({
  providedIn: 'root',
})
export class CCTControlService {
  private _cct: BehaviorSubject<number> = new BehaviorSubject<number>(6600);
  private _activeTransition = new BehaviorSubject<CCTTransitionTask | undefined>(undefined);
  public readonly driverSteamVr: SteamVrCctControlDriver;
  /** The driver that matches the active HMD; null while none does. */
  public readonly activeDriver: Observable<CctControlDriver | null>;
  public readonly driverIsAvailable: Observable<boolean>;
  /** The active driver while it can write; null otherwise. */
  private writableDriver: CctControlDriver | null = null;
  public readonly activeTransition = this._activeTransition.asObservable();
  public cctCSSColor: string = 'white';

  get cct(): number {
    return this._cct.value;
  }

  public readonly cctStream: Observable<number> = this._cct.asObservable();

  constructor(
    private openvr: OpenVRService,
    appSettingsService: AppSettingsService
  ) {
    this.driverSteamVr = new SteamVrCctControlDriver(openvr, appSettingsService.settings);
    // the SteamVR driver can match any headset, so it stays last
    const drivers: CctControlDriver[] = [this.driverSteamVr];
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
    if (this.writableDriver?.skipsTransitions) {
      this.cancelActiveTransition();
      const task = new CancellableTask(() =>
        this.setCCT(temperature, { cancelActiveTransition: false, logReason: opt.logReason })
      );
      task.start();
      return task;
    }
    if (this._cct.value === temperature) {
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
    transition.onComplete.subscribe(() => {
      if (transition.isComplete() && this._activeTransition.value === transition)
        this._activeTransition.next(undefined);
    });
    transition.onError.subscribe(() => {
      if (transition.isError() && this._activeTransition.value === transition)
        this._activeTransition.next(undefined);
    });
    if (opt.logReason) {
      info(`[CCTControl] Starting CCT transition (Reason: ${opt.logReason})`);
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

  async setCCT(
    cct: number,
    options: Partial<SetBrightnessOrCCTOptions> = SET_BRIGHTNESS_OR_CCT_OPTIONS_DEFAULTS,
    force = false
  ) {
    const opt = { ...SET_BRIGHTNESS_OR_CCT_OPTIONS_DEFAULTS, ...(options ?? {}) };
    cct = clamp(Math.round(cct), 1000, 10000);
    if (opt.cancelActiveTransition) this.cancelActiveTransition();
    if (cct === this.cct && !force) return;
    this._cct.next(cct);
    await this.writableDriver?.setCCT(cct);
    if (opt.logReason) {
      await info(`[CCTControl] Set CCT to ${cct}K (Reason: ${opt.logReason})`);
    }
  }

  private watchDrivers() {
    // write the app's value once a driver can write it
    this.activeDriver
      .pipe(
        switchMap((driver) =>
          (driver?.isAvailable() ?? of(false)).pipe(map((available) => (available ? driver : null)))
        ),
        distinctUntilChanged(),
        startWith(null),
        pairwise()
      )
      .subscribe(([previous, driver]) => {
        this.writableDriver = driver;
        if (driver && !previous)
          this.setCCT(this.cct, SET_BRIGHTNESS_OR_CCT_OPTIONS_DEFAULTS, true);
      });

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
