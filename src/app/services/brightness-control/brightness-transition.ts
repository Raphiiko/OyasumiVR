import { CancellableTask } from '../../utils/cancellable-task';
import { BrightnessControlService } from './brightness-control.service';
import { clamp } from '../../utils/number-utils';
import { info, warn } from 'tauri-plugin-log-api';

export function createBrightnessTransitionTask(
  brightnessControl: BrightnessControlService,
  targetBrightness: number,
  duration: number,
  frequency = 60
): CancellableTask {
  return new CancellableTask(async (task, taskStatus) => {
    // Ensure the target brightness is within the bounds of the brightness control
    const [min, max] = await brightnessControl.getBrightnessBounds();
    const clampedBrightness = clamp(targetBrightness, min, max);
    if (clampedBrightness != targetBrightness) {
      warn(
        `[BrightnessControl] Attempted to transition to out-of-bounds brightness (${targetBrightness}%, ${duration}ms)`
      );
    }
    targetBrightness = clampedBrightness;
    // Get the current brightness
    const currentBrightness = await brightnessControl.fetchBrightness();
    if (currentBrightness === undefined) {
      warn(
        `[BrightnessControl] Could not start brightness transition as current brightness was unavailable.`
      );
      throw 'BRIGHTNESS_UNAVAILABLE';
    }
    // Calculate the brightness delta
    const brightnessDelta = targetBrightness - currentBrightness;
    // Calculate the number of steps to take
    const steps = Math.round((duration / 1000) * frequency);
    // Start transitioning
    info(
      `[BrightnessControl] Starting display brightness transition (${currentBrightness}%=>${targetBrightness}%, ${duration}ms)`
    );
    const startTime = Date.now();
    while (Date.now() <= startTime + duration) {
      // Sleep to match the frequency
      await new Promise((resolve) => setTimeout(resolve, 1000 / frequency));
      // Stop if the transition was cancelled
      if (task.isCancelled()) {
        info(
          `[BrightnessControl] Cancelled running display brightness transition (${currentBrightness}%=>${targetBrightness}%, ${duration}ms)`
        );
        return;
      }
      // Calculate the required brightness
      const timeExpired = Date.now() - startTime;
      const progress = clamp(timeExpired / duration, 0, 1);
      const brightness = smoothLerp(currentBrightness, targetBrightness, progress);
      // Set the intermediary brightness
      await brightnessControl.setBrightness(brightness, 'BRIGHTNESS_AUTOMATION');
    }
    // Set the final target brightness
    await brightnessControl.setBrightness(targetBrightness, 'BRIGHTNESS_AUTOMATION');
    info(
      `[BrightnessControl] Finished display brightness transition (${currentBrightness}%=>${targetBrightness}%, ${duration}ms)`
    );
  });
}

function smoothLerp(min: number, max: number, percent: number) {
  const t = percent * percent * (3 - 2 * percent); // cubic easing function
  return min + t * (max - min);
}
