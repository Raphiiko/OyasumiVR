import { OVRDevice } from './ovr-device';

export interface DeviceUpdateEvent {
  device: OVRDevice;
}

export interface SleepDetectorStateReport {
  distanceInLast15Minutes: number;
  distanceInLast10Seconds: number;
  startTime: number;
  lastLog: number;
}
