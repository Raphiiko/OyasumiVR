import { OVRDevice } from './ovr-device';

export interface DeviceUpdateEvent {
  device: OVRDevice;
}

export interface SleepDetectorStateReport {
  distanceInLast15Minutes: number;
  distanceInLast10Minutes: number;
  distanceInLast5Minutes: number;
  distanceInLast1Minute: number;
  distanceInLast10Seconds: number;
  rotationInLast15Minutes: number;
  rotationInLast10Minutes: number;
  rotationInLast5Minutes: number;
  rotationInLast1Minute: number;
  rotationInLast10Seconds: number;
  startTime: number;
  lastLog: number;
}
