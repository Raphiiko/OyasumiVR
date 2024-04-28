export interface MqttConfig {
  enabled: boolean;
  host: string | null;
  port: number | null;
  username: string | null;
  password: string | null;
  secureSocket: boolean;
}

export type MqttStatus = 'DISABLED' | 'CONNECTED' | 'DISCONNECTED' | 'ERROR';

export type MqttProperty =
  | MqttToggleProperty
  | MqttButtonProperty
  | MqttSensorProperty
  | MqttNumberProperty
  | MqttLightProperty;

export interface MqttPropertyBase {
  id: string;
  displayName: string;
  topicPath: string;
  available?: boolean;
  device?: MqttDiscoveryConfigDevice; // Used to override the default OyasumiVR device
  deviceClass?: string;
}

export interface MqttToggleProperty extends MqttPropertyBase {
  type: 'TOGGLE';
  value: boolean;
}

export interface MqttButtonProperty extends MqttPropertyBase {
  type: 'BUTTON';
}

export interface MqttSensorProperty extends MqttPropertyBase {
  type: 'SENSOR';
  value: string;
  unitOfMeasurement?: string;
  stateClass?: string;
}

export interface MqttNumberProperty extends MqttPropertyBase {
  type: 'NUMBER';
  value: number;
  min?: number;
  max?: number;
  unitOfMeasurement?: string;
}

export interface MqttLightProperty extends MqttPropertyBase {
  type: 'LIGHT';
  state: boolean;
  rgbMode?: boolean;
  rgbValue: [number, number, number];
}

export interface MqttDiscoveryConfigBase {
  device: MqttDiscoveryConfigDevice;
  origin: {
    name: string;
    sw_version: string;
    support_url: string;
  };
  availability: {
    topic: string;
  }[];
  availability_mode: 'all' | 'any' | 'latest';
  device_class?: string;
}

export interface MqttDiscoveryConfigDevice {
  identifiers: string[];
  name?: string;
  model?: string;
  manufacturer?: string;
  hw_version?: string;
  serial_number?: string;
  sw_version?: string;
}
