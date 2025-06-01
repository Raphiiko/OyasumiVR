export interface DeviceManagerData {
  version: 1;
  knownDevices: DMKnownDevice[];
  tags: DMDeviceTag[];
}

export const DMDeviceTypes = ['HMD', 'TRACKER', 'CONTROLLER', 'LIGHTHOUSE'] as const;
export type DMDeviceType = (typeof DMDeviceTypes)[number];

export interface DMKnownDevice {
  id: string;
  defaultName: string;
  nickname?: string;
  deviceType: DMDeviceType;
  lastSeen: number;
  tagIds: string[];
}

export interface DMDeviceTag {
  id: string;
  name: string;
  color: string;
}

export const DEVICE_MANAGER_DATA_DEFAULT: DeviceManagerData = {
  version: 1,
  knownDevices: [],
  tags: [],
};

export const DEVICE_MANAGER_TAG_COLORS = [
  '#F44336', // Red 500
  '#E91E63', // Pink 500
  '#9C27B0', // Purple 500
  '#673AB7', // Deep Purple 500
  '#3F51B5', // Indigo 500
  '#2196F3', // Blue 500
  '#00BCD4', // Cyan 500
  '#4CAF50', // Green 500
  '#FF9800', // Orange 500
  '#795548', // Brown 500
] as const;
