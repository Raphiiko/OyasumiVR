import {
  HardwareBrightnessControlDriver,
  HardwareBrightnessControlDriverBounds,
} from './hardware-brightness-control-driver';
import { clamp } from '../../../utils/number-utils';
import { OpenVRService } from '../../openvr.service';
import { combineLatest, debounceTime, map, Observable } from 'rxjs';
import { AppSettings } from '../../../models/settings';
import { OVRDevice } from '../../../models/ovr-device';

// Without a known panel curve, the reported gain range maps linearly onto 10% to 100%.
export const ANALOG_GAIN_HARDWARE_BRIGHTNESS_CONTROL_DRIVER_BOUNDS: HardwareBrightnessControlDriverBounds =
  {
    softwareStops: [10, 100],
    hardwareStops: [0, 100],
    overdriveThreshold: 100,
    riskThreshold: 100,
  };

/** The HMD's analog gain range, or null when it does not report a usable one. */
export function analogGainRange(hmd: OVRDevice | undefined): [number, number] | null {
  if (!hmd?.displaySupportsAnalogGain) return null;
  const min = hmd.displayMinAnalogGain;
  const max = hmd.displayMaxAnalogGain;
  if (typeof min !== 'number' || typeof max !== 'number') return null;
  if (!isFinite(min) || !isFinite(max) || max <= min) return null;
  return [min, max];
}

/** Writes SteamVR's analogGain on any headset that reports a range, when the user opts in. */
export class AnalogGainHardwareBrightnessControlDriver extends HardwareBrightnessControlDriver {
  /** The active HMD's range; null while unavailable. */
  private range: [number, number] | null = null;
  private readonly available: Observable<boolean>;

  constructor(
    appSettings: Observable<AppSettings>,
    private openvr: OpenVRService
  ) {
    super(appSettings);
    this.available = combineLatest([this.openvr.status, this.openvr.devices, appSettings]).pipe(
      debounceTime(0),
      map(([status, devices, settings]) => {
        const hmd = devices.find((d) => d.class === 'HMD');
        this.range = status === 'INITIALIZED' ? analogGainRange(hmd) : null;
        return settings.hardwareBrightnessOnUnsupportedHmds && !!this.range;
      })
    );
  }

  getBrightnessConfiguration(): HardwareBrightnessControlDriverBounds {
    return ANALOG_GAIN_HARDWARE_BRIGHTNESS_CONTROL_DRIVER_BOUNDS;
  }

  getBrightnessBounds(): [number, number] {
    const config = this.getBrightnessConfiguration();
    return [config.softwareStops[0], config.softwareStops[1]];
  }

  async getBrightnessPercentage(): Promise<number> {
    if (!this.range) return 100;
    const [min, max] = this.range;
    const analogGain = clamp(await this.openvr.getAnalogGain(), min, max);
    const hardwarePercentage = ((analogGain - min) / (max - min)) * 100;
    return Math.round(this.hardwarePercentageToSoftwarePercentage(hardwarePercentage));
  }

  async setBrightnessPercentage(percentage: number): Promise<void> {
    if (!this.range) return;
    const [min, max] = this.range;
    percentage = clamp(this.softwarePercentageToHardwarePercentage(percentage), 0, 100);
    this.openvr.setAnalogGain(min + ((max - min) * percentage) / 100);
  }

  isAvailable(): Observable<boolean> {
    return this.available;
  }
}
