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
  // Status properties
  isTurningOff: boolean;
}
