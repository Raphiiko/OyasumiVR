export type OVRDeviceClass =
  | 'Invalid'
  | 'HMD'
  | 'Controller'
  | 'GenericTracker'
  | 'TrackingReference'
  | 'DisplayRedirect';

export type OVRDeviceRole =
  | 'Invalid'
  | 'LeftHand'
  | 'RightHand'
  | 'OptOut'
  | 'Treadmill'
  | 'Stylus';

export interface OVRDevice {
  // Native properties
  battery: number;
  canPowerOff: boolean;
  class: OVRDeviceClass;
  role: OVRDeviceRole;
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
