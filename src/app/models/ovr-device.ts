export type OVRDeviceClass =
  | 'Invalid'
  | 'HMD'
  | 'Controller'
  | 'GenericTracker'
  | 'TrackingReference'
  | 'DisplayRedirect';

export interface OVRDevice {
  // Native properties
  battery: number;
  canPowerOff: boolean;
  class: OVRDeviceClass;
  dongleId: string;
  hardwareRevision: string;
  index: number;
  isCharging: boolean;
  manufacturerName: string;
  modelNumber: string;
  providesBatteryStatus: boolean;
  serialNumber: string;
  pose: any;
  // Status properties
  isTurningOff: boolean;
}

export interface OVRDevicePose {
  quaternion: [number, number, number, number];
  position: [number, number, number];
}
