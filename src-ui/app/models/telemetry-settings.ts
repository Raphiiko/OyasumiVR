export interface TelemetrySettings {
  version: 2;
  enabled: boolean;
  reportingCache: Array<{
    event: string;
    timestamp: number;
    lastValue: string;
    timeout: number;
  }>;
}

export const TELEMETRY_SETTINGS_DEFAULT: TelemetrySettings = {
  version: 2,
  enabled: true,
  reportingCache: [],
};
