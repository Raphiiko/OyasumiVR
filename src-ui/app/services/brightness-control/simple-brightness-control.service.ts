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
import { info, warn } from '@tauri-apps/plugin-log';
import { CancellableTask } from '../../utils/cancellable-task';
import { BrightnessTransitionTask } from './brightness-transition';
import { AutomationConfigService } from '../automation-config.service';
import {
  AdoptedBrightness,
  HardwareBrightnessControlService,
} from './hardware-brightness-control.service';
import {
  HardwareBrightnessControlDriver,
  HardwareBrightnessFade,
} from './hardware-brightness-drivers/hardware-brightness-control-driver';
import { SoftwareBrightnessControlService } from './software-brightness-control.service';
import { lerp } from '../../utils/number-utils';
import { clamp } from 'lodash';
import {
  SET_BRIGHTNESS_OR_CCT_OPTIONS_DEFAULTS,
  SetBrightnessOrCCTOptions,
  SetBrightnessOrCCTReason,
} from './brightness-control-models';
import { listen } from '@tauri-apps/api/event';
import { DeviceFade } from '../../utils/device-fade';

type SimpleTransition = CancellableTask & { readonly targetBrightness: number };

/**
 * Splits a simple value into software and hardware brightness: software dimming below the
 * hardware minimum, hardware above it. A device that fades a simple curve splits it the same way.
 */
export function splitSimpleBrightness(
  percentage: number,
  [min, max]: [number, number]
): { software: number; hardware: number } {
  const floor = Math.max(min, 0);
  if (percentage < floor) return { software: lerp(0, 100, percentage / floor), hardware: min };
  return { software: 100, hardware: lerp(min, max, (percentage - floor) / (100 - floor)) };
}

@Injectable({
  providedIn: 'root',
})
export class SimpleBrightnessControlService {
  private _advancedMode = new BehaviorSubject(false);
  private _modeGeneration = 0;
  /** Bumped by every set and device fade, so an older set skips its late hardware write. */
  private _writeGeneration = 0;
  private _brightness: BehaviorSubject<number> = new BehaviorSubject<number>(100);
  private _activeTransition = new BehaviorSubject<SimpleTransition | undefined>(undefined);
  public readonly activeTransition = this._activeTransition.asObservable();
  /** Counts running `setBrightness` calls, whose own replies must not be adopted midway. */
  private settingBrightness = 0;
  /** The active driver at the last driver change, to recognize a handoff between drivers. */
  private previousDriver: HardwareBrightnessControlDriver | null = null;
  /** The last driver that was not null; it stays set through a gap without a driver. */
  private lastDriver: HardwareBrightnessControlDriver | null = null;
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
        filter(() => !this._advancedMode.value),
        skip(1),
        distinctUntilChanged(),
        // a device that pushes its brightness changes keeps its value across availability changes
        // availability can change before onDriverChange updates lastDriver, so ask the active one
        filter(
          () =>
            !(this.hardwareBrightnessControl.activeDriver ?? this.lastDriver)
              ?.pushesBrightnessChanges
        )
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
    if (driver) this.lastDriver = driver;
    // a device taking over from a pushing one never saw the simple value
    if (
      !this._advancedMode.value &&
      previous?.pushesBrightnessChanges &&
      driver &&
      driver !== previous &&
      !driver.pushesBrightnessChanges
    ) {
      this.setBrightness(this.brightness, { cancelActiveTransition: true, logReason: undefined });
    }
  }

  /** Derives the simple value from a hardware value the device reported. */
  private async adoptHardwareBrightness(adopted: AdoptedBrightness) {
    if (this._advancedMode.value || this._activeTransition.value) return;
    // a replayed report can come from a device that is no longer in use
    if (!this.hardwareBrightnessControl.activeDriver?.pushesBrightnessChanges) return;
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
      // a pushing device's value can differ from the derived simple value, so it still gets the write
      const write = this.hardwareBrightnessControl.activeDriver?.pushesBrightnessChanges
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
    const fade = this.deviceFade(percentage, duration, opt.logReason);
    if (fade) return fade;
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
    return this.activate(transition, opt.logReason);
  }

  /**
   * A fade the active device runs. The device runs the hardware part of the simple curve, and this
   * PC runs the software part on the same curve once the device accepts.
   */
  private deviceFade(
    percentage: number,
    duration: number,
    logReason: SetBrightnessOrCCTReason | null
  ): SimpleTransition | null {
    const driver = this.hardwareBrightnessControl.activeDriver;
    if (!driver) return null;
    const from = this.brightness;
    const to = clamp(percentage, 0, 100);
    const bounds = driver.getBrightnessBounds();
    let software: BrightnessTransitionTask | undefined;
    const fade = this.hardwareBrightnessControl.deviceFade({
      target: splitSimpleBrightness(to, bounds).hardware,
      durationMs: duration,
      simple: { from, to },
      shownTarget: to,
      onAccept: () => {
        software = new BrightnessTransitionTask(
          'SIMPLE',
          (simple) => this.applySoftwarePart(simple, bounds),
          async () => from,
          async () => [0, 100],
          to,
          fade!.durationMs,
          { logReason }
        );
        void software.start();
      },
    });
    if (!fade) return null;
    this.cancelActiveTransition();
    this._writeGeneration++;
    fade.onCancelled.subscribe(() => this.onDeviceFadeCancelled(fade, software));
    // the device can complete first, such as in standby, so the software part ends on its target
    fade.onComplete.subscribe(() => {
      if (fade.end !== 'completed') return;
      software?.cancel();
      void this.applySoftwarePart(to, bounds);
    });
    return this.activate(fade, logReason);
  }

  /**
   * Stops the software part where it is. After a change on the headset the headset's value wins,
   * by the rule for reports.
   */
  private onDeviceFadeCancelled(fade: HardwareBrightnessFade, software?: BrightnessTransitionTask) {
    software?.cancel();
    if (this._activeTransition.value === fade) this._activeTransition.next(undefined);
    if (fade.end !== 'changedOnDevice') return;
    void firstValueFrom(this.hardwareBrightnessControl.adoptedBrightness).then((adopted) =>
      this.adoptHardwareBrightness(adopted)
    );
  }

  /** Shows a simple value and writes only its software part. */
  private async applySoftwarePart(simple: number, bounds: [number, number]) {
    this._brightness.next(simple);
    await this.softwareBrightnessControl.setBrightness(
      splitSimpleBrightness(simple, bounds).software,
      { cancelActiveTransition: true, logReason: null }
    );
  }

  /** Makes the transition the active one until it ends, and starts it. */
  private activate(
    transition: SimpleTransition,
    logReason: SetBrightnessOrCCTReason | null
  ): SimpleTransition {
    const clear = () => {
      if (this._activeTransition.value === transition) this._activeTransition.next(undefined);
    };
    transition.onComplete.subscribe(() => transition.isComplete() && clear());
    transition.onError.subscribe(() => transition.isError() && clear());
    // runs with the error status, so no newer request can start in between
    if (transition instanceof DeviceFade) {
      transition.onError.subscribe((error) => this.onFadeRefused(transition, error));
    }
    if (logReason) {
      info(`[BrightnessControl] Starting brightness transition (Reason: ${logReason})`);
    }
    this._activeTransition.next(transition);
    const started = transition.start();
    if (transition instanceof DeviceFade) started.catch(() => {});
    return transition;
  }

  /** Sets the target in one command instead. */
  private onFadeRefused(fade: SimpleTransition, error: unknown) {
    warn(`[BrightnessControl] The headset refused a brightness fade: ${error}`);
    this.setBrightness(fade.targetBrightness, { cancelActiveTransition: false });
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
    const writeGeneration = ++this._writeGeneration;
    if (opt.cancelActiveTransition) this.cancelActiveTransition();
    this._brightness.next(percentage);
    if (opt.logReason) {
      await info(`[BrightnessControl] Set brightness to ${percentage}% (Reason: ${opt.logReason})`);
    }
    // Calculate brightnesses
    let softwareBrightness = percentage;
    let hardwareBrightness = 100;
    // a matching driver keeps its part until the headset can take it
    const usesHardware = this.hardwareBrightnessControl.activeDriver !== null;
    if (usesHardware) {
      const bounds = await firstValueFrom(this.hardwareBrightnessControl.brightnessBounds);
      ({ software: softwareBrightness, hardware: hardwareBrightness } = splitSimpleBrightness(
        percentage,
        bounds
      ));
    }
    // Set brightnesses
    if (modeGeneration !== this._modeGeneration) return;
    await this.softwareBrightnessControl.setBrightness(softwareBrightness, {
      cancelActiveTransition: true,
      logReason: null,
    });
    if (modeGeneration !== this._modeGeneration) return;
    if (writeGeneration !== this._writeGeneration) return;
    if (usesHardware) {
      await this.hardwareBrightnessControl.setBrightness(hardwareBrightness, {
        cancelActiveTransition: true,
        logReason: null,
      });
    }
  }
}
