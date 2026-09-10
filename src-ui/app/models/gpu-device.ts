export type GPUPowerLimitUnit = 'W' | '%';

export interface GPUDevice {
  name: string;
  id: string;
  type: 'NVIDIA' | 'AMD';
  powerLimitUnit: GPUPowerLimitUnit;
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
