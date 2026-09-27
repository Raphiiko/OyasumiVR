import { Injectable } from '@angular/core';
import {
  BehaviorSubject,
  distinctUntilChanged,
  filter,
  firstValueFrom,
  map,
  Observable,
  skip,
  tap,
} from 'rxjs';
import { info } from '@tauri-apps/plugin-log';
import { CancellableTask } from '../../utils/cancellable-task';
import { BrightnessTransitionTask } from './brightness-transition';
import { AutomationConfigService } from '../automation-config.service';
import {
  AdoptedBrightness,
  HardwareBrightnessControlService,
} from './hardware-brightness-control.service';
import { HardwareBrightnessControlDriver } from './hardware-brightness-drivers/hardware-brightness-control-driver';
import { SoftwareBrightnessControlService } from './software-brightness-control.service';
import { lerp } from '../../utils/number-utils';
import { clamp } from 'lodash';
import {
  SET_BRIGHTNESS_OR_CCT_OPTIONS_DEFAULTS,
  SetBrightnessOrCCTOptions,
} from './brightness-control-models';
import { listen } from '@tauri-apps/api/event';

@Injectable({
  providedIn: 'root',
})
export class SimpleBrightnessControlService {
  private _advancedMode = new BehaviorSubject(false);
  private _modeGeneration = 0;
  private _brightness: BehaviorSubject<number> = new BehaviorSubject<number>(100);
  private _activeTransition = new BehaviorSubject<BrightnessTransitionTask | undefined>(undefined);
  public readonly activeTransition = this._activeTransition.asObservable();
  private hardwareBrightnessDriverAvailable = false;
  /** Counts running `setBrightness` calls, whose own replies must not be adopted midway. */
  private settingBrightness = 0;
  /** The active driver at the last driver change, to recognize a handoff between drivers. */
  private previousDriver: HardwareBrightnessControlDriver | null = null;
  /** The latest report skipped while `settingBrightness` was above zero. */
  private deferredAdoption: AdoptedBrightness | null = null;
  public readonly advancedMode = this._advancedMode.asObservable();

  get brightness(): number {
    return this._brightness.value;
  }

  public readonly brightnessStream: Observable<number> = this._brightness.asObservable();

  constructor(
    private automationConfigService: AutomationConfigService,
    private hardwareBrightnessControl: HardwareBrightnessControlService,
    private softwareBrightnessControl: SoftwareBrightnessControlService
  ) {}

  async init() {
    await listen<number>('setSimpleBrightness', async (event) => {
      await this.setBrightness(event.payload, { cancelActiveTransition: true });
    });
    // apply brightness on mode changes
    this.automationConfigService.configs
      .pipe(
        map((configs) => configs.BRIGHTNESS_AUTOMATIONS.advancedMode),
        distinctUntilChanged(),
        tap((advancedMode) => this._advancedMode.next(advancedMode)),
        skip(1)
      )
      .subscribe(async (advancedMode) => {
        this._modeGeneration++;
        this.cancelActiveTransition();
        this.hardwareBrightnessControl.cancelActiveTransition();
        this.softwareBrightnessControl.cancelActiveTransition();
        if (!advancedMode) {
          await this.setBrightness(this.brightness, {
            cancelActiveTransition: true,
            logReason: undefined,
          });
        }
      });
    // Set brightness when the hardware brightness driver availability changes
    this.hardwareBrightnessControl.driverIsAvailable
      .pipe(
        tap((available) => (this.hardwareBrightnessDriverAvailable = available)),
        filter(() => !this._advancedMode.value),
        skip(1),
        distinctUntilChanged(),
        // a device that reports its own brightness keeps it across availability changes
        filter(() => !this.hardwareBrightnessControl.lastActiveDriver?.reportsBrightness)
      )
      .subscribe(() => {
        this.setBrightness(this.brightness, {
          cancelActiveTransition: true,
          logReason: undefined,
        });
      });
    // the driver can change while availability stays true
    this.hardwareBrightnessControl.onDriverChange.subscribe(() => this.onDriverChange());
    this.hardwareBrightnessControl.adoptedBrightness.subscribe((adopted) =>
      this.adoptHardwareBrightness(adopted)
    );
  }

  private onDriverChange() {
    const driver = this.hardwareBrightnessControl.activeDriver;
    const previous = this.previousDriver;
    this.previousDriver = driver;
    // a running transition would write a reporting device at every step, so finish it at once
    this.finishTransitionForReportingDriver();
    // a device taking over from a reporting one never saw the simple value
    if (
      !this._advancedMode.value &&
      previous?.reportsBrightness &&
      driver &&
      driver !== previous &&
      !driver.reportsBrightness
    ) {
      this.setBrightness(this.brightness, { cancelActiveTransition: true, logReason: undefined });
    }
  }

  private finishTransitionForReportingDriver() {
    const transition = this._activeTransition.value;
    if (!transition || !this.hardwareBrightnessControl.lastActiveDriver?.reportsBrightness) return;
    this.setBrightness(transition.targetBrightness, {
      cancelActiveTransition: true,
      logReason: null,
    });
  }

  /** Derives the simple value from a hardware value the device reported. */
  private async adoptHardwareBrightness(adopted: AdoptedBrightness) {
    if (this._advancedMode.value || this._activeTransition.value) return;
    // a replayed report can come from a device that is no longer in use
    if (!this.hardwareBrightnessControl.activeDriver?.reportsBrightness) return;
    if (this.settingBrightness) {
      this.deferredAdoption = adopted;
      return;
    }
    const { percentage: hardware, bounds } = adopted;
    const [min, max] = bounds;
    if (hardware <= min + 0.01) {
      this._brightness.next(clamp((min * this.softwareBrightnessControl.brightness) / 100, 0, 100));
      return;
    }
    // the headset's choice wins over leftover software dimming
    this._brightness.next(clamp(min + ((hardware - min) / (max - min)) * (100 - min), 0, 100));
    if (this.softwareBrightnessControl.brightness < 100) {
      await this.softwareBrightnessControl.setBrightness(100, {
        cancelActiveTransition: true,
        logReason: null,
      });
    }
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
    if (
      this.hardwareBrightnessDriverAvailable &&
      this.hardwareBrightnessControl.lastActiveDriver?.reportsBrightness
    ) {
      this.cancelActiveTransition();
      const task = new CancellableTask(() =>
        this.setBrightness(percentage, { cancelActiveTransition: false, logReason: opt.logReason })
      );
      task.start();
      return task;
    }
    this._activeTransition.value?.cancel();
    const transition = new BrightnessTransitionTask(
      'SIMPLE',
      this.setBrightness.bind(this),
      async () => this.brightness,
      async () => [0, 100],
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
      info(`[BrightnessControl] Starting brightness transition (Reason: ${opt.logReason})`);
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
    options: Partial<SetBrightnessOrCCTOptions> = SET_BRIGHTNESS_OR_CCT_OPTIONS_DEFAULTS
  ) {
    this.settingBrightness++;
    try {
      await this.applyBrightness(percentage, options);
    } finally {
      this.settingBrightness--;
      this.adoptDeferredReport();
    }
  }

  /**
   * Adopts a report skipped during the last change, such as the value kept after a failed write.
   * A report the hardware cache no longer shows is an older reply and stays skipped.
   */
  private adoptDeferredReport() {
    const deferred = this.deferredAdoption;
    if (this.settingBrightness || !deferred) return;
    this.deferredAdoption = null;
    if (deferred.percentage === this.hardwareBrightnessControl.brightness) {
      void this.adoptHardwareBrightness(deferred);
    }
  }

  private async applyBrightness(
    percentage: number,
    options: Partial<SetBrightnessOrCCTOptions> = SET_BRIGHTNESS_OR_CCT_OPTIONS_DEFAULTS
  ) {
    const opt = { ...SET_BRIGHTNESS_OR_CCT_OPTIONS_DEFAULTS, ...(options ?? {}) };
    percentage = clamp(percentage, 0, 100);
    const modeGeneration = this._modeGeneration;
    if (opt.cancelActiveTransition) this.cancelActiveTransition();
    this._brightness.next(percentage);
    if (opt.logReason) {
      await info(`[BrightnessControl] Set brightness to ${percentage}% (Reason: ${opt.logReason})`);
    }
    // Calculate brightnesses
    let softwareBrightness = percentage;
    let hardwareBrightness = 100;
    // If the hardware brightness driver is available, intelligently switch between the two brightnesses
    if (this.hardwareBrightnessDriverAvailable) {
      const softwareBrightnessRange = [0, 0];
      const hardwareBrightnessRange = await firstValueFrom(
        this.hardwareBrightnessControl.brightnessBounds
      );
      if (hardwareBrightnessRange[0] > 0) {
        softwareBrightnessRange[1] = hardwareBrightnessRange[0];
      }
      if (percentage >= 0 && percentage < softwareBrightnessRange[1]) {
        hardwareBrightness = hardwareBrightnessRange[0];
        softwareBrightness = lerp(0, 100, percentage / softwareBrightnessRange[1]);
      } else {
        softwareBrightness = 100;
        hardwareBrightness = lerp(
          hardwareBrightnessRange[0],
          hardwareBrightnessRange[1],
          (percentage - softwareBrightnessRange[1]) / (100 - softwareBrightnessRange[1])
        );
      }
    }
    // Set brightnesses
    if (modeGeneration !== this._modeGeneration) return;
    await this.softwareBrightnessControl.setBrightness(softwareBrightness, {
      cancelActiveTransition: true,
      logReason: null,
    });
    if (modeGeneration !== this._modeGeneration) return;
    if (this.hardwareBrightnessDriverAvailable) {
      await this.hardwareBrightnessControl.setBrightness(hardwareBrightness, {
        cancelActiveTransition: true,
        logReason: null,
      });
    }
  }
}
