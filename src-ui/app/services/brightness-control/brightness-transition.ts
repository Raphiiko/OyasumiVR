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
    private setBrightness: (
      percentage: number,
      options?: Partial<SetBrightnessOrCCTOptions>
    ) => Promise<void>,
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
    const currentBrightness = await this.getBrightness();
    if (currentBrightness === undefined) {
      warn(
        `[BrightnessControl] Could not start ${label} brightness transition as current ${label} brightness was unavailable. (Reason: ${
          this.options.logReason ?? 'NONE'
        })`
      );
      throw 'BRIGHTNESS_UNAVAILABLE';
    }
    const startTime = Date.now();
    while (Date.now() <= startTime + this.duration) {
      await new Promise((resolve) => setTimeout(resolve, 1000 / this.options.frequency!));
      if (task.isCancelled()) {
        info(
          `[BrightnessControl] Cancelled running ${label} brightness transition (${currentBrightness}%=>${this.targetBrightness}%, ${this.duration}ms, Reason: ${this.options.logReason})`
        );
        return;
      }
      const timeExpired = Date.now() - startTime;
      const progress = clamp(timeExpired / this.duration, 0, 1);
      const brightness = smoothLerp(currentBrightness, this.targetBrightness, progress);
      await this.setBrightness(brightness, {
        cancelActiveTransition: false,
        logReason: undefined,
      });
    }
    if (task.isCancelled()) return;
    await this.setBrightness(this.targetBrightness, {
      cancelActiveTransition: false,
      logReason: undefined,
    });
    if (this.options.logReason) {
      await info(
        `[BrightnessControl] Finished ${label} brightness transition (${currentBrightness}%=>${this.targetBrightness}%, ${this.duration}ms, Reason: ${this.options.logReason})`
      );
    }
  }
}
