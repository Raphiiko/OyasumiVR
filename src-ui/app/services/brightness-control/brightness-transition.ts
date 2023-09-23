import { CancellableTask } from '../../utils/cancellable-task';
import { clamp } from '../../utils/number-utils';
import { info, warn } from 'tauri-plugin-log-api';
import { SetBrightnessOptions, SetBrightnessReason } from './brightness-control-models';

interface BrightnessTransitionTaskOptions {
  frequency: number;
  logReason: SetBrightnessReason | null;
}

const DEFAULT_BRIGHTNESS_TRANSITION_TASK_OPTIONS: BrightnessTransitionTaskOptions = {
  frequency: 60,
  logReason: null,
};

export function createBrightnessTransitionTask(
  type: 'DISPLAY' | 'IMAGE' | 'SIMPLE',
  setBrightness: (percentage: number, options?: Partial<SetBrightnessOptions>) => Promise<void>,
  getBrightness: () => Promise<number | undefined>,
  getBrightnessBounds: () => Promise<[number, number]>,
  targetBrightness: number,
  duration: number,
  options: Partial<BrightnessTransitionTaskOptions> = DEFAULT_BRIGHTNESS_TRANSITION_TASK_OPTIONS
): CancellableTask {
  const opt = { ...DEFAULT_BRIGHTNESS_TRANSITION_TASK_OPTIONS, ...(options ?? {}) };
  return new CancellableTask(async (task) => {
    const label = type.toLowerCase();
    // Ensure the target brightness is within the bounds of the brightness control
    const [min, max] = await getBrightnessBounds();
    const clampedBrightness = clamp(targetBrightness, min, max);
    if (clampedBrightness != targetBrightness) {
      warn(
        `[BrightnessControl] Attempted to transition to out-of-bounds ${label} brightness (Target: ${targetBrightness}%, Duration: ${duration}ms, Reason: ${
          opt.logReason ?? 'NONE'
        })`
      );
    }
    targetBrightness = clampedBrightness;
    // Get the current brightness
    const currentBrightness = await getBrightness();
    if (currentBrightness === undefined) {
      warn(
        `[BrightnessControl] Could not start ${label} brightness transition as current ${label} brightness was unavailable. (Reason: ${
          opt.logReason ?? 'NONE'
        })`
      );
      throw 'BRIGHTNESS_UNAVAILABLE';
    }
    // Start transitioning
    const startTime = Date.now();
    while (Date.now() <= startTime + duration) {
      // Sleep to match the frequency
      await new Promise((resolve) => setTimeout(resolve, 1000 / opt.frequency!));
      // Stop if the transition was cancelled
      if (task.isCancelled() && opt.logReason) {
        info(
          `[BrightnessControl] Cancelled running ${label} brightness transition (${currentBrightness}%=>${targetBrightness}%, ${duration}ms, Reason: ${opt.logReason})`
        );
        return;
      }
      // Calculate the required brightness
      const timeExpired = Date.now() - startTime;
      const progress = clamp(timeExpired / duration, 0, 1);
      const brightness = smoothLerp(currentBrightness, targetBrightness, progress);
      // Set the intermediary brightness
      await setBrightness(brightness, {
        cancelActiveTransition: false,
        logReason: undefined,
      });
    }
    // Set the final target brightness
    await setBrightness(targetBrightness, {
      cancelActiveTransition: false,
      logReason: undefined,
    });
    if (opt.logReason) {
      await info(
        `[BrightnessControl] Finished ${label} brightness transition (${currentBrightness}%=>${targetBrightness}%, ${duration}ms, Reason: ${opt.logReason})`
      );
    }
  });
}

function smoothLerp(min: number, max: number, percent: number) {
  const t = percent * percent * (3 - 2 * percent); // cubic easing function
  return min + t * (max - min);
}
