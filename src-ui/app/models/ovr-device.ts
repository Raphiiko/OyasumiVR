import type {
  OVRDevice as CoreOVRDevice,
  OVRHandleType,
  PowerMethod,
  TrackedControllerRole,
  TrackedDeviceClass,
} from '../bindings';

export type { OVRHandleType };
export type OVRDeviceClass = TrackedDeviceClass;
export type OVRDeviceRole = TrackedControllerRole;

/** How OyasumiVR turns the device off. */
export type OVRDevicePowerMethod = PowerMethod | 'SteamFrame';

export interface OVRDevice {
  // Native properties
  battery: number;
  canPowerOff?: boolean;
  class: OVRDeviceClass;
  role: OVRDeviceRole;
  handleType?: OVRHandleType;
  dongleId?: string;
  hardwareRevision?: string;
  index: number;
  isCharging?: boolean;
  manufacturerName?: string;
  modelNumber?: string;
  isConnected: boolean;
  powerMethod: OVRDevicePowerMethod;
  providesBatteryStatus?: boolean;
  serialNumber?: string;
  pose: any;
  hmdOnHead?: boolean;
  hmdActivity?: string;
  displayFrequency?: number;
  displaySupportsAnalogGain?: boolean;
  displayMinAnalogGain?: number;
  displayMaxAnalogGain?: number;

  // Status properties
  isTurningOff: boolean;
}

/** The core sends null for unknown values, which this model types as absent. */
export function fromCoreDevice(device: CoreOVRDevice): OVRDevice {
  return device as OVRDevice;
}
