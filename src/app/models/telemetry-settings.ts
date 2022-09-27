import { v4 as uuidv4 } from 'uuid';

export interface TelemetrySettings {
  version: 1;
  enabled: boolean;
  telemetryId: string;
  lastHeartbeat: number;
}

export const TELEMETRY_SETTINGS_DEFAULT: TelemetrySettings = {
  version: 1,
  enabled: true,
  telemetryId: uuidv4(),
  lastHeartbeat: 0,
};
