import { Injectable, OnDestroy } from '@angular/core';
import {
  BehaviorSubject,
  distinctUntilChanged,
  filter,
  firstValueFrom,
  map,
  Observable,
  skip,
  tap,
  merge,
  take,
  Subscription,
  combineLatest,
} from 'rxjs';
import { info } from '@tauri-apps/plugin-log';
import { CancellableTask } from '../../utils/cancellable-task';
import { BrightnessTransitionTask } from './brightness-transition';
import { AutomationConfigService } from '../automation-config.service';
import { HardwareBrightnessControlService } from './hardware-brightness-control.service';
import { SoftwareBrightnessControlService } from './software-brightness-control.service';
import { lerp, smoothLerp } from '../../utils/number-utils';
import { clamp } from 'lodash';
import {
  SET_BRIGHTNESS_OR_CCT_OPTIONS_DEFAULTS,
  SetBrightnessOrCCTOptions,
} from './brightness-control-models';
import { listen } from '@tauri-apps/api/event';

@Injectable({
  providedIn: 'root',
})
export class SimpleBrightnessControlService implements OnDestroy {
  private readonly frameSubscriptions = new Subscription();
  private _advancedMode = new BehaviorSubject(false);
  private _modeGeneration = 0;
  private _requestGeneration = 0;
  private _brightness: BehaviorSubject<number> = new BehaviorSubject<number>(100);
  private _activeTransition = new BehaviorSubject<
    (CancellableTask & { targetBrightness: number }) | undefined
  >(undefined);
  public readonly activeTransition = this._activeTransition.asObservable();
  private hardwareBrightnessDriverAvailable = false;
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
    if (this.hardwareBrightnessControl.brightnessStream) {
      this.frameSubscriptions.add(
        combineLatest([
          this.hardwareBrightnessControl.brightnessStream,
          this.hardwareBrightnessControl.brightnessBounds,
          this.softwareBrightnessControl.brightnessStream,
        ]).subscribe(([hardware, [min, max], software]) => {
          if (
            this._advancedMode.value ||
            this._activeTransition.value ||
            !this.hardwareBrightnessControl.hasFrameCompanion
          )
            return;
          const simple =
            hardware <= min + 0.001
              ? (min * software) / 100
              : min + ((hardware - min) / (max - min)) * (100 - min);
          this._brightness.next(clamp(simple, 0, 100));
        })
      );
    }
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
        distinctUntilChanged()
      )
      .subscribe(() => {
        if (this.hardwareBrightnessControl.hasFrameCompanion) return;
        this.setBrightness(this.brightness, {
          cancelActiveTransition: true,
          logReason: undefined,
        });
      });
  }

  transitionBrightness(
    percentage: number,
    duration: number,
    options: Partial<SetBrightnessOrCCTOptions> = SET_BRIGHTNESS_OR_CCT_OPTIONS_DEFAULTS
  ): CancellableTask {
    const opt = { ...SET_BRIGHTNESS_OR_CCT_OPTIONS_DEFAULTS, ...(options ?? {}) };
    if (
      this._brightness.value === percentage &&
      !this.hardwareBrightnessControl.delegatesTransitions
    ) {
      const task = new CancellableTask();
      task.start();
      return task;
    }
    this._requestGeneration++;
    this._activeTransition.value?.cancel();
    if (this.hardwareBrightnessControl.delegatesTransitions) {
      const from = this.brightness;
      const transition = new CancellableTask(async (task) => {
        const [min, max] = await firstValueFrom(this.hardwareBrightnessControl.brightnessBounds);
        if (task.isCancelled()) return;
        const target = percentage < min ? min : lerp(min, max, (percentage - min) / (100 - min));
        const delegated = this.hardwareBrightnessControl.delegateTransition(
          target,
          duration,
          { from, to: percentage },
          async (progress) => {
            if (task.isCancelled()) return;
            const value = smoothLerp(from, percentage, progress);
            await this.softwareBrightnessControl.setBrightness(
              value < min ? (value / min) * 100 : 100,
              { cancelActiveTransition: true, logReason: null }
            );
            if (!task.isCancelled()) this._brightness.next(value);
          }
        );
        if (!delegated) throw 'not_ready';
        const cancel = task.onCancelled.subscribe(() => delegated.cancel());
        try {
          await firstValueFrom(
            merge(
              delegated.onComplete,
              delegated.onCancelled,
              delegated.onError.pipe(
                map((error) => {
                  throw error;
                })
              )
            ).pipe(take(1))
          );
        } finally {
          cancel.unsubscribe();
        }
      });
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

  ngOnDestroy() {
    this.frameSubscriptions.unsubscribe();
    this.cancelActiveTransition();
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
    const opt = { ...SET_BRIGHTNESS_OR_CCT_OPTIONS_DEFAULTS, ...(options ?? {}) };
    percentage = clamp(percentage, 0, 100);
    const modeGeneration = this._modeGeneration;
    const requestGeneration = ++this._requestGeneration;
    if (opt.cancelActiveTransition) this.cancelActiveTransition();
    if (opt.logReason) {
      await info(`[BrightnessControl] Set brightness to ${percentage}% (Reason: ${opt.logReason})`);
    }
    // map the hardware floor to software dimming
    let softwareBrightness = percentage;
    let hardwareBrightness = 100;
    if (
      this.hardwareBrightnessDriverAvailable ||
      this.hardwareBrightnessControl.hasFrameCompanion
    ) {
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
    // apply both brightness values
    if (modeGeneration !== this._modeGeneration || requestGeneration !== this._requestGeneration)
      return;
    await this.softwareBrightnessControl.setBrightness(softwareBrightness, {
      cancelActiveTransition: true,
      logReason: null,
    });
    if (modeGeneration !== this._modeGeneration || requestGeneration !== this._requestGeneration)
      return;
    if (
      this.hardwareBrightnessDriverAvailable ||
      this.hardwareBrightnessControl.hasFrameCompanion
    ) {
      await this.hardwareBrightnessControl.setBrightness(hardwareBrightness, {
        cancelActiveTransition: true,
        logReason: null,
      });
    }
    if (modeGeneration === this._modeGeneration && requestGeneration === this._requestGeneration)
      this._brightness.next(percentage);
  }
}
