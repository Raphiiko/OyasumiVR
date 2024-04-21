export interface MqttConfig {
  enabled: boolean;
  host: string | null;
  port: number | null;
  username: string | null;
  password: string | null;
  secureSocket: boolean;
}

export type MqttStatus = 'DISABLED' | 'CONNECTED' | 'DISCONNECTED' | 'ERROR';

export type MqttProperty = MqttToggleProperty;

export interface MqttToggleProperty {
  type: 'TOGGLE';
  id: string;
  displayName: string;
  value: boolean;
}
