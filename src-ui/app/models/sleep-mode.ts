import { AutomationType } from './automations';

export type SleepModeStatusChangeReasonType = 'MANUAL' | 'OSC_CONTROL' | 'AUTOMATION';

export type SleepModeStatusChangeReason =
  | ManualSleepModeStatusChangeReason
  | OSCControlSleepModeStatusChangeReason
  | AutomationSleepModeStatusChangeReason;

export interface SleepModeStatusChangeReasonBase {
  enabled?: boolean;
  type: SleepModeStatusChangeReasonType;
}

export interface ManualSleepModeStatusChangeReason extends SleepModeStatusChangeReasonBase {
  type: 'MANUAL';
}

export interface OSCControlSleepModeStatusChangeReason extends SleepModeStatusChangeReasonBase {
  type: 'OSC_CONTROL';
}

export interface AutomationSleepModeStatusChangeReason extends SleepModeStatusChangeReasonBase {
  type: 'AUTOMATION';
  automation: AutomationType;
}
