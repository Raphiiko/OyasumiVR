import type { AudioDeviceDto } from 'src-ui/app/bindings';

export type { AudioDeviceType } from 'src-ui/app/bindings';

export interface AudioDevice extends AudioDeviceDto {
  parsedName?: AudioDeviceParsedName;
  persistentId?: string;
}

export interface AudioDeviceParsedName {
  display: string;
  driver: string;
}
