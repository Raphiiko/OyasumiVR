import { CancellableTask } from './cancellable-task';

/** How a fade the device ran ended. `changedOnDevice` means the device's value no longer follows it. */
export type DeviceFadeEnd = 'completed' | 'changedOnDevice' | 'stopped';

/**
 * A transition the device runs itself. It completes on `completed` and cancels itself on every
 * other end. It fails when the device refuses it.
 */
export abstract class DeviceFade extends CancellableTask {
  /** How the fade ended, set before the task cancels itself; null after a cancel from outside. */
  end: DeviceFadeEnd | null = null;
  /** How long the device runs the fade, which can be shorter than requested. */
  abstract readonly durationMs: number;

  /** A cancel from outside wins over a completed end that has not reached the task status yet. */
  override cancel() {
    if (this.end === 'completed' && !this.isComplete()) this.end = null;
    super.cancel();
  }
}
