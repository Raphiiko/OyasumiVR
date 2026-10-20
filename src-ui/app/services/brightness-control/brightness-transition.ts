import { CancellableTask } from '../../utils/cancellable-task';
import { clamp, smoothLerp } from '../../utils/number-utils';
import { info, warn } from '@tauri-apps/plugin-log';
import { SetBrightnessOrCCTOptions, SetBrightnessOrCCTReason } from './brightness-control-models';

interface BrightnessTransitionTaskOptions {
  frequency: number;
  logReason: SetBrightnessOrCCTReason | null;
}

const DEFAULT_BRIGHTNESS_TRANSITION_TASK_OPTIONS: BrightnessTransitionTaskOptions = {
  frequency: 60,
  logReason: null,
};

export class BrightnessTransitionTask extends CancellableTask {
  private options: BrightnessTransitionTaskOptions;

  constructor(
    public readonly type: 'HARDWARE' | 'SOFTWARE' | 'SIMPLE',
    /** Resolves false when the headset refused the value; only a twice-refused target fails the transition. */
    private setBrightness: (
      percentage: number,
      options?: Partial<SetBrightnessOrCCTOptions>
    ) => Promise<boolean | void>,
    private getBrightness: () => Promise<number | undefined>,
    private getBrightnessBounds: () => Promise<[number, number]>,
    public readonly targetBrightness: number,
    public readonly duration: number,
    options: Partial<BrightnessTransitionTaskOptions> = DEFAULT_BRIGHTNESS_TRANSITION_TASK_OPTIONS
  ) {
    super();
    this.work = this.task.bind(this);
    this.options = { ...DEFAULT_BRIGHTNESS_TRANSITION_TASK_OPTIONS, ...(options ?? {}) };
  }

  private async task(task: CancellableTask): Promise<void> {
    const label = this.type.toLowerCase();
    // Get the current brightness
    const currentBrightness = await this.getBrightness();
    if (currentBrightness === undefined) {
      warn(
        `[BrightnessControl] Could not start ${label} brightness transition as current ${label} brightness was unavailable. (Reason: ${
          this.options.logReason ?? 'NONE'
        })`
      );
      throw 'BRIGHTNESS_UNAVAILABLE';
    }
    // Start transitioning
    const startTime = Date.now();
    while (Date.now() <= startTime + this.duration) {
      // Sleep to match the frequency
      await new Promise((resolve) => setTimeout(resolve, 1000 / this.options.frequency!));
      // Stop if the transition was cancelled
      if (task.isCancelled() && this.options.logReason) {
        info(
          `[BrightnessControl] Cancelled running ${label} brightness transition (${currentBrightness}%=>${this.targetBrightness}%, ${this.duration}ms, Reason: ${this.options.logReason})`
        );
        return;
      }
      // Calculate the required brightness
      const timeExpired = Date.now() - startTime;
      const progress = clamp(timeExpired / this.duration, 0, 1);
      const brightness = smoothLerp(currentBrightness, this.targetBrightness, progress);
      // Set the intermediary brightness, the next frame replaces a refused one
      await this.apply(brightness);
    }
    // Set the final target brightness, retrying once so a single refused write does not fail it
    if (!(await this.apply(this.targetBrightness)) && !(await this.apply(this.targetBrightness))) {
      throw new Error(`The headset did not accept brightness ${this.targetBrightness}%`);
    }
    if (this.options.logReason) {
      await info(
        `[BrightnessControl] Finished ${label} brightness transition (${currentBrightness}%=>${this.targetBrightness}%, ${this.duration}ms, Reason: ${this.options.logReason})`
      );
    }
  }

  private async apply(brightness: number): Promise<boolean> {
    const applied = await this.setBrightness(brightness, {
      cancelActiveTransition: false,
      logReason: undefined,
    });
    return applied !== false;
  }
}
