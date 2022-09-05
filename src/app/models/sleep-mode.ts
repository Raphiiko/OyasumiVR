import { AutomationType } from './automations';

export type SleepModeStatusChangeReasonType = 'MANUAL' | 'AUTOMATION';

export type SleepModeStatusChangeReason =
  | ManualSleepModeStatusChangeReason
  | AutomationSleepModeStatusChangeReason;

export interface SleepModeStatusChangeReasonBase {
  enabled?: boolean;
  type: SleepModeStatusChangeReasonType;
}

export interface ManualSleepModeStatusChangeReason extends SleepModeStatusChangeReasonBase {
  type: 'MANUAL';
}

export interface AutomationSleepModeStatusChangeReason extends SleepModeStatusChangeReasonBase {
  type: 'AUTOMATION';
  automation: AutomationType;
}
