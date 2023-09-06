import { CancellableTask } from '../../utils/cancellable-task';
import { clamp } from '../../utils/number-utils';
import { info, warn } from 'tauri-plugin-log-api';

export function createBrightnessTransitionTask(
  type: 'DISPLAY' | 'IMAGE' | 'SIMPLE',
  setBrightness: (percentage: number, reason: 'DIRECT' | 'INDIRECT') => Promise<void>,
  getBrightness: () => Promise<number | undefined>,
  getBrightnessBounds: () => Promise<[number, number]>,
  targetBrightness: number,
  duration: number,
  frequency = 60
): CancellableTask {
  return new CancellableTask(async (task) => {
    const label = type.toLowerCase();
    // Ensure the target brightness is within the bounds of the brightness control
    const [min, max] = await getBrightnessBounds();
    const clampedBrightness = clamp(targetBrightness, min, max);
    if (clampedBrightness != targetBrightness) {
      warn(
        `[BrightnessControl] Attempted to transition to out-of-bounds ${label} brightness (${targetBrightness}%, ${duration}ms)`
      );
    }
    targetBrightness = clampedBrightness;
    // Get the current brightness
    const currentBrightness = await getBrightness();
    if (currentBrightness === undefined) {
      warn(
        `[BrightnessControl] Could not start ${label} brightness transition as current ${label} brightness was unavailable.`
      );
      throw 'BRIGHTNESS_UNAVAILABLE';
    }
    // Start transitioning
    const startTime = Date.now();
    while (Date.now() <= startTime + duration) {
      // Sleep to match the frequency
      await new Promise((resolve) => setTimeout(resolve, 1000 / frequency));
      // Stop if the transition was cancelled
      if (task.isCancelled()) {
        info(
          `[BrightnessControl] Cancelled running ${label} brightness transition (${currentBrightness}%=>${targetBrightness}%, ${duration}ms)`
        );
        return;
      }
      // Calculate the required brightness
      const timeExpired = Date.now() - startTime;
      const progress = clamp(timeExpired / duration, 0, 1);
      const brightness = smoothLerp(currentBrightness, targetBrightness, progress);
      // Set the intermediary brightness
      await setBrightness(brightness, 'INDIRECT');
    }
    // Set the final target brightness
    await setBrightness(targetBrightness, 'INDIRECT');
    info(
      `[BrightnessControl] Finished ${label} brightness transition (${currentBrightness}%=>${targetBrightness}%, ${duration}ms)`
    );
  });
}

function smoothLerp(min: number, max: number, percent: number) {
  const t = percent * percent * (3 - 2 * percent); // cubic easing function
  return min + t * (max - min);
}
