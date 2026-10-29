import type { AudioDeviceDto } from '../bindings';

export type { AudioDeviceType } from '../bindings';

export interface AudioDevice extends AudioDeviceDto {
  parsedName?: AudioDeviceParsedName;
  persistentId?: string;
}

export interface AudioDeviceParsedName {
  display: string;
  driver: string;
}
