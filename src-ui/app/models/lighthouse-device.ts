import { LighthouseDeviceModel, LighthousePowerState } from '../bindings';

export interface LighthouseDevice extends LighthouseDeviceModel {
  // For UI purposes only
  transitioningToPowerState?: LighthousePowerState;
}

export type { LighthouseDeviceType } from '../bindings';

export type LighthouseDevicePowerState = LighthousePowerState;
