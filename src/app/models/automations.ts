import { OVRDeviceClass } from './ovr-device';

export type AutomationType =
  | 'BATTERY_PERCENTAGE'
  | 'CONTROLLER_POWER_OFF'
  | 'TIME_EVENT'
  | 'CHARGING_EVENT';

export interface AutomationConfigs {
  version: 1;
  BATTERY_PERCENTAGE: BatteryPercentageAutomationConfig;
  CONTROLLER_POWER_OFF: ControllerPoweroffAutomationConfig;
  TIME_EVENT: TimeEventAutomationConfig;
  CHARGING_EVENT: ChargingEventAutomationConfig;
}

export interface AutomationConfig {
  enabled: boolean;
}

export interface BatteryPercentageAutomationConfig extends AutomationConfig {
  triggerClasses: OVRDeviceClass[];
  threshold: number;
  powerOffClasses: OVRDeviceClass[];
}

export interface ControllerPoweroffAutomationConfig extends AutomationConfig {}
export interface TimeEventAutomationConfig extends AutomationConfig {
  time: string | null;
  powerOffClasses: OVRDeviceClass[];
}
export interface ChargingEventAutomationConfig extends AutomationConfig {
  powerOffClasses: OVRDeviceClass[];
}

export const AUTOMATION_DEFAULT_CONFIG: AutomationConfigs = {
  version: 1,
  BATTERY_PERCENTAGE: {
    enabled: false,
    triggerClasses: ['GenericTracker'],
    threshold: 50,
    powerOffClasses: ['GenericTracker'],
  },
  CONTROLLER_POWER_OFF: { enabled: false },
  TIME_EVENT: { enabled: false, time: null, powerOffClasses: ['GenericTracker'] },
  CHARGING_EVENT: { enabled: false, powerOffClasses: ['Controller', 'GenericTracker'] },
};
