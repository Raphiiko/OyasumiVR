export interface TelemetryManifest {
  v1: TelemetryManifestV1;
}

export interface TelemetryManifestV1 {
  heartbeatUrl: string;
  heartbeatHeaders: { [key: string]: string };
}
