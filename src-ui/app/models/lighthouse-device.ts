import { LighthouseDeviceModel_Serialize, LighthousePowerState } from 'src-ui/app/bindings';

export interface LighthouseDevice extends LighthouseDeviceModel_Serialize {
  // For UI purposes only
  transitioningToPowerState?: LighthousePowerState;
}

export type { LighthouseDeviceType } from 'src-ui/app/bindings';

export type LighthouseDevicePowerState = LighthousePowerState;
