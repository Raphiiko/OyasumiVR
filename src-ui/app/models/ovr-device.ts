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

export type OVRHandleType = 
  | "HandPrimary"
  | "HandSecondary"
  | "Head"
  | "Gamepad"
  | "Treadmill"
  | "Stylus"
  | "FootLeft"
  | "FootRight"
  | "ShoulderLeft"
  | "ShoulderRight"
  | "ElbowLeft"
  | "ElbowRight"
  | "KneeLeft"
  | "KneeRight"
  | "WristLeft"
  | "WristRight"
  | "AnkleLeft"
  | "AnkleRight"
  | "Waist"
  | "Chest"
  | "Camera"
  | "Keyboard"

export interface OVRDevice {
  // Native properties
  battery: number;
  canPowerOff: boolean;
  class: OVRDeviceClass;
  role: OVRDeviceRole;
  handleType?: OVRHandleType;
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
