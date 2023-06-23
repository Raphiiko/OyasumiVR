export interface LighthouseDevice {
  id: string;
  deviceName: string;
  deviceType: 'lighthouseV2';
  powerState: LighthouseDevicePowerState;
  // For UI purposes only
  transitioningToPowerState: LighthouseDevicePowerState | undefined;
}

export type LighthouseDevicePowerState = 'on' | 'unknown' | 'sleep' | 'standby' | 'booting';
