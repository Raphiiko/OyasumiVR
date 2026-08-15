// Superseded ids are the Windows device path, `BluetoothLE#BluetoothLE<adapter mac>-<device mac>`.
// Current ids are the base station's own MAC address.
const LIGHTHOUSE_ID_PATTERN =
  /^BluetoothLE#BluetoothLE[0-9a-f]{2}(?::[0-9a-f]{2}){5}-([0-9a-f]{2}(?::[0-9a-f]{2}){5})$/i;
const KNOWN_DEVICE_ID_PATTERN = /^(LH_[A-Za-z0-9]+_)(.+)$/;

/**
 * Returns null when the id is already in the current format, or is not a Windows base station id.
 */
export function migrateLighthouseDeviceId(id: string): string | null {
  const match = LIGHTHOUSE_ID_PATTERN.exec(id);
  return match ? match[1].toUpperCase() : null;
}

/**
 * Same as {@link migrateLighthouseDeviceId}, for the `LH_<type>_<device id>` ids the device manager
 * keeps for known devices.
 */
export function migrateKnownLighthouseDeviceId(id: string): string | null {
  const match = KNOWN_DEVICE_ID_PATTERN.exec(id);
  if (!match) return null;
  const deviceId = migrateLighthouseDeviceId(match[2]);
  return deviceId ? match[1] + deviceId : null;
}
