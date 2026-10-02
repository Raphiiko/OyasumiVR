import { Observable } from 'rxjs';

export abstract class CctControlDriver {
  /** Names the driver in the log. */
  abstract readonly name: string;
  /** True when the driver sets a value in one command, so the service runs no transition steps. */
  readonly skipsTransitions: boolean = false;
  /**
   * True when the driver sends every color temperature change the device makes. OyasumiVR shows
   * that value instead of writing its stored one, and leaves it to skip a set it does not need.
   */
  readonly pushesCctChanges: boolean = false;
  /** Values the device reported or applied. OyasumiVR shows them and never writes them back. */
  readonly cctUpdates?: Observable<number>;

  /** Whether the active HMD belongs to this driver, including while the driver cannot write yet. */
  abstract matches(): Observable<boolean>;

  /**
   * Whether the driver can write now. OyasumiVR reads it only while `matches` is true, and writes
   * its stored value when it turns true, unless the driver pushes its own.
   */
  abstract isAvailable(): Observable<boolean>;

  /**
   * Called while the driver matches, also before it is available. The driver drops or keeps a
   * value it cannot apply yet.
   */
  abstract setCCT(kelvin: number): Promise<void>;
}
