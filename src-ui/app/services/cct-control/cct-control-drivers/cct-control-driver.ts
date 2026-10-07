import { Observable } from 'rxjs';
import { DeviceFade } from '../../../utils/device-fade';

/** What the CCT service asks a driver to fade. */
export interface CctFadeOptions {
  /** Color temperature in Kelvin. */
  target: number;
  durationMs: number;
}

/** A color temperature fade the device runs; `targetCCT` is the value the UI shows as the target. */
export type CctFade = DeviceFade & { readonly targetCCT: number };

export abstract class CctControlDriver {
  /** Names the driver in the log. */
  abstract readonly name: string;
  /**
   * True when the driver sends every color temperature change the device makes. OyasumiVR shows
   * that value instead of writing its stored one, and leaves it to skip a set it does not need.
   */
  readonly pushesCctChanges: boolean = false;
  /** Values the device reported or applied. OyasumiVR shows them and never writes them back. */
  readonly cctUpdates?: Observable<number>;

  /**
   * Whether the active HMD belongs to this driver. It gets every set and keeps or drops one it
   * cannot send yet.
   */
  abstract matches(): Observable<boolean>;

  /**
   * Whether the device is connected, for the UI. OyasumiVR writes its stored value when it turns
   * true, unless the driver pushes its own.
   */
  abstract isAvailable(): Observable<boolean>;

  abstract setCCT(kelvin: number): Promise<void>;

  /** A fade the device runs itself, or null when it cannot run one now. */
  fade(_options: CctFadeOptions): CctFade | null {
    return null;
  }
}
