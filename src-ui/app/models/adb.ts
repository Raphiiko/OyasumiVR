// ADB Server Status - Discriminated union for Rust enum with data
export type ADBServerStatus =
  | { status: 'notFound'; message: string }
  | { status: 'unknownError'; message: string }
  | { status: 'running' };

export type ADBDeviceState =
  /** The device is not connected to adb or is not responding. */
  | 'offline'
  /** The device is now connected to the adb server. Note that this state does not imply that the Android system is fully booted and operational because the device connects to adb while the system is still booting. However, after boot-up, this is the normal operational state of an device. */
  | 'device'
  /** There is no device connected. */
  | 'noDevice'
  /** Device is being authorized */
  | 'authorizing'
  /** The device is unauthorized. */
  | 'unauthorized'
  /** Haven't received a response from the device yet. */
  | 'connecting'
  /** Insufficient permissions to communicate with the device. */
  | 'noPerm'
  /** USB device detached from the adb server (known but not opened/claimed). */
  | 'detached'
  /** Device running fastboot OS (fastboot) or userspace fastboot (fastbootd). */
  | 'bootloader'
  /** What a device sees from its end of a Transport (adb host). */
  | 'host'
  /** Device with bootloader loaded but no ROM OS loaded (adbd). */
  | 'recovery'
  /** Device running Android OS Sideload mode (minadbd sideload mode). */
  | 'sideload'
  /** Device running Android OS Rescue mode (minadbd rescue mode). */
  | 'rescue';

export interface ADBDevice {
  identifier: string;
  state: ADBDeviceState;
  usb: string;
  product: string;
  model: string;
  device: string;
  transportId: number;
}
