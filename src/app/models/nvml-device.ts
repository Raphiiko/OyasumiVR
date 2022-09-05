export interface NVMLDevice {
  uuid: string;
  name: string;
  powerLimit?: number;
  minPowerLimit?: number;
  maxPowerLimit?: number;
  defaultPowerLimit?: number;
}
