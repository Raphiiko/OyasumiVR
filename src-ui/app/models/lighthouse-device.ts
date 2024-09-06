export interface LighthouseDevice {
  id: string;
  deviceName: string;
  deviceType: LighthouseDeviceType;
  powerState: LighthouseDevicePowerState;
  v1Timeout: number | null;
  // For UI purposes only
  transitioningToPowerState: LighthouseDevicePowerState | undefined;
}

export type LighthouseDeviceType = 'lighthouseV1' | 'lighthouseV2';

export type LighthouseDevicePowerState = 'on' | 'unknown' | 'sleep' | 'standby' | 'booting';
