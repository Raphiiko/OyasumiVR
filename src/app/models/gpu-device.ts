export interface GPUDevice {
  name: string;
  id: string;
  type: 'NVIDIA';
  supportsPowerLimiting: boolean;
  minPowerLimit?: number;
  maxPowerLimit?: number;
  defaultPowerLimit?: number;
  powerLimit?: number;
}

export interface GPUPowerLimit {
  limit: number;
  default: boolean;
}
