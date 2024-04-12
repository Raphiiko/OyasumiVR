import { AutomationType } from './automations';

export type SleepModeStatusChangeReasonType = 'MANUAL' | 'HOTKEY' | 'OSC_CONTROL' | 'AUTOMATION';

export type SleepModeStatusChangeReason =
  | ManualSleepModeStatusChangeReason
  | HotkeySleepModeStatusChangeReason
  | OSCControlSleepModeStatusChangeReason
  | AutomationSleepModeStatusChangeReason
  | SleepModeDisableOnPlayerJoinOrLeaveAutomationSleepModeStatusChangeReason;

export interface SleepModeStatusChangeReasonBase {
  enabled?: boolean;
  type: SleepModeStatusChangeReasonType;
}

export interface ManualSleepModeStatusChangeReason extends SleepModeStatusChangeReasonBase {
  type: 'MANUAL';
}

export interface HotkeySleepModeStatusChangeReason extends SleepModeStatusChangeReasonBase {
  type: 'HOTKEY';
}

export interface OSCControlSleepModeStatusChangeReason extends SleepModeStatusChangeReasonBase {
  type: 'OSC_CONTROL';
}

export interface AutomationSleepModeStatusChangeReason extends SleepModeStatusChangeReasonBase {
  type: 'AUTOMATION';
  automation: Exclude<AutomationType, 'SLEEP_MODE_DISABLE_ON_PLAYER_JOIN_OR_LEAVE'>;
}

export interface SleepModeDisableOnPlayerJoinOrLeaveAutomationSleepModeStatusChangeReason
  extends SleepModeStatusChangeReasonBase {
  type: 'AUTOMATION';
  automation: 'SLEEP_MODE_DISABLE_ON_PLAYER_JOIN_OR_LEAVE';
  event: 'join' | 'leave';
  displayName: string;
}
