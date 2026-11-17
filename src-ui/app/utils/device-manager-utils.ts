import type { OVRDevice } from '../models/ovr-device';

/** The known device id of an OpenVR device. */
export function knownDeviceIdForOpenVR(device: Pick<OVRDevice, 'class' | 'serialNumber'>): string {
  return `OVR_${device.class}_${device.serialNumber}`;
}
