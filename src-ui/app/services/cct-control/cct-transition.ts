import { CancellableTask } from '../../utils/cancellable-task';
import { clamp, smoothLerp } from '../../utils/number-utils';
import { info, warn } from '@tauri-apps/plugin-log';
import {
  SetBrightnessOrCCTOptions,
  SetBrightnessOrCCTReason,
} from '../brightness-control/brightness-control-models';

interface CCTTransitionTaskOptions {
  frequency: number;
  logReason: SetBrightnessOrCCTReason | null;
}

const DEFAULT_CCT_TRANSITION_TASK_OPTIONS: CCTTransitionTaskOptions = {
  frequency: 60,
  logReason: null,
};

export class CCTTransitionTask extends CancellableTask {
  private options: CCTTransitionTaskOptions;

  constructor(
    private setCCT: (
      percentage: number,
      options?: Partial<SetBrightnessOrCCTOptions>
    ) => Promise<void>,
    private getCCT: () => Promise<number | undefined>,
    public readonly targetCCT: number,
    public readonly duration: number,
    options: Partial<CCTTransitionTaskOptions> = DEFAULT_CCT_TRANSITION_TASK_OPTIONS
  ) {
    super();
    this.work = this.task.bind(this);
    this.options = { ...DEFAULT_CCT_TRANSITION_TASK_OPTIONS, ...(options ?? {}) };
  }

  private async task(task: CancellableTask): Promise<void> {
    // Get the current cct
    const currentCCT = await this.getCCT();
    if (currentCCT === undefined) {
      warn(
        `[CCTControl] Could not start CCT transition as current CCT was unavailable. (Reason: ${
          this.options.logReason ?? 'NONE'
        })`
      );
      throw 'CCT_UNAVAILABLE';
    }
    // Start transitioning
    const startTime = Date.now();
    while (Date.now() <= startTime + this.duration) {
      // Sleep to match the frequency
      await new Promise((resolve) => setTimeout(resolve, 1000 / this.options.frequency!));
      // Stop if the transition was cancelled
      if (task.isCancelled() && this.options.logReason) {
        info(
          `[CCTControl] Cancelled running CCT transition (${currentCCT}%=>${this.targetCCT}%, ${this.duration}ms, Reason: ${this.options.logReason})`
        );
        return;
      }
      // Calculate the required cct
      const timeExpired = Date.now() - startTime;
      const progress = clamp(timeExpired / this.duration, 0, 1);
      const cct = smoothLerp(currentCCT, this.targetCCT, progress);
      // Set the intermediary cct
      await this.setCCT(cct, {
        cancelActiveTransition: false,
        logReason: undefined,
      });
    }
    // Set the final target cct
    await this.setCCT(this.targetCCT, {
      cancelActiveTransition: false,
      logReason: undefined,
    });
    if (this.options.logReason) {
      await info(
        `[CCTControl] Finished CCT transition (${currentCCT}%=>${this.targetCCT}%, ${this.duration}ms, Reason: ${this.options.logReason})`
      );
    }
  }
}
