import { CancellableTask } from './cancellable-task';

/**
 * How a fade the device ran ended. `changedOnDevice` means the device's value no longer follows
 * the fade, and `deviceGone` means another device took over before the fade ended.
 */
export type DeviceFadeEnd = 'completed' | 'changedOnDevice' | 'deviceGone' | 'stopped';

/**
 * A transition the device runs itself. It completes on `completed` and cancels itself on every
 * other end. It fails when the device refuses it.
 */
export abstract class DeviceFade extends CancellableTask {
  /** How the fade ended, set before the task cancels itself; null after a cancel from outside. */
  end: DeviceFadeEnd | null = null;
}
