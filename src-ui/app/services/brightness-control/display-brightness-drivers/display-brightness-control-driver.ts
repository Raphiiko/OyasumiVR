import { Observable } from 'rxjs';

export abstract class DisplayBrightnessControlDriver {
  abstract getBrightnessPercentage(): Promise<number>;
  abstract setBrightnessPercentage(percentage: number): Promise<void>;
  abstract getBrightnessBounds(): Promise<[number, number]>;
  abstract isAvailable(): Observable<boolean>;
}
