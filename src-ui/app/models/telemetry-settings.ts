export interface TelemetrySettings {
  version: 2;
  enabled: boolean;
}

export const TELEMETRY_SETTINGS_DEFAULT: TelemetrySettings = {
  version: 2,
  enabled: true,
};
