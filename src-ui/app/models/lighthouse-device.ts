import { LighthouseDeviceModel_Serialize, LighthousePowerState } from '../bindings';

export interface LighthouseDevice extends LighthouseDeviceModel_Serialize {
  // For UI purposes only
  transitioningToPowerState?: LighthousePowerState;
}

export type { LighthouseDeviceType } from '../bindings';

export type LighthouseDevicePowerState = LighthousePowerState;
