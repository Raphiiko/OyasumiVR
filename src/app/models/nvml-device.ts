export interface NVMLDevice {
  index: number;
  name: string;
  powerLimit: number;
  minPowerLimit: number;
  maxPowerLimit: number;
  defaultPowerLimit: number;
}
