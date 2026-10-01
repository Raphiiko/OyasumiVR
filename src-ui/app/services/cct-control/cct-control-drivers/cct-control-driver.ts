import { Observable } from 'rxjs';

export abstract class CctControlDriver {
  /** Names the driver in the log. */
  abstract readonly name: string;
  /** True when the driver sets a value in one command, so the service runs no transition steps. */
  readonly skipsTransitions: boolean = false;
  /**
   * Set by a driver that reports the device's value. That driver owns the shown value: OyasumiVR
   * shows what it emits, never writes it back, and leaves it to skip a set it does not need.
   */
  readonly cctUpdates?: Observable<number>;

  /** Whether the active HMD belongs to this driver, including while the driver cannot write yet. */
  abstract matches(): Observable<boolean>;

  /**
   * Whether the driver can write now. OyasumiVR reads it only while `matches` is true, and writes
   * its stored value when it turns true, unless the driver reports its own.
   */
  abstract isAvailable(): Observable<boolean>;

  /**
   * Called while the driver matches, also before it is available. The driver drops or keeps a
   * value it cannot apply yet.
   */
  abstract setCCT(kelvin: number): Promise<void>;
}
