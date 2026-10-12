export interface TelemetrySettings {
  version: 2;
  enabled: boolean;
  /** App version of the last launch, null before the first. */
  lastVersion: string | null;
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
  lastVersion: null,
  reportingCache: [],
};
