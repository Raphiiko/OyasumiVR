import { Observable } from 'rxjs';

export abstract class CctControlDriver {
  /** Names the driver in the log. */
  abstract readonly name: string;
  /** True when the driver sets a value in one command, so the service runs no transition steps. */
  readonly skipsTransitions: boolean = false;

  /** Whether the active HMD belongs to this driver, including while the driver cannot write yet. */
  abstract matches(): Observable<boolean>;

  /** Whether the driver can write now. OyasumiVR reads it only while `matches` is true. */
  abstract isAvailable(): Observable<boolean>;

  abstract setCCT(kelvin: number): Promise<void>;
}
