import { SleepModeStatusChangeReason } from './sleep-mode';
import { UserStatus } from 'vrchat/dist';

export type EventLog = {
  version: number;
  logs: EventLogEntry[];
};

export const EVENT_LOG_DEFAULT: EventLog = {
  version: 1,
  logs: [],
};

export type EventLogEntry =
  | EventLogSleepModeEnabled
  | EventLogSleepModeDisabled
  | EventLogTurnedOffDevices
  | EventLogGpuPowerLimitChanged
  | EventLogBrightnessChanged
  | EventLogAcceptedInviteRequest
  | EventLogStatusChangedOnPlayerCountChange
  | EventLogSleepDetectorEnableCancelled;

export type EventLogDraft = Omit<EventLogEntry, 'time' | 'id'>;

export type EventLogType =
  | 'sleepModeEnabled'
  | 'sleepModeDisabled'
  | 'turnedOffDevices'
  | 'gpuPowerLimitChanged'
  | 'brightnessChanged'
  | 'acceptedInviteRequest'
  | 'statusChangedOnPlayerCountChange'
  | 'sleepDetectorEnableCancelled';

export interface EventLogBase {
  id: string;
  type: EventLogType;

  time: number;
}

export interface EventLogSleepModeEnabled extends EventLogBase {
  type: 'sleepModeEnabled';
  reason: SleepModeStatusChangeReason;
}

export interface EventLogSleepModeDisabled extends EventLogBase {
  type: 'sleepModeDisabled';
  reason: SleepModeStatusChangeReason;
}

export interface EventLogTurnedOffDevices extends EventLogBase {
  type: 'turnedOffDevices';
  reason: 'MANUAL' | 'OSC_CONTROL' | 'SLEEP_MODE_ENABLED' | 'CHARGING';
  devices: 'CONTROLLER' | 'CONTROLLERS' | 'TRACKER' | 'TRACKERS' | 'ALL' | 'VARIOUS';
}

export interface EventLogGpuPowerLimitChanged extends EventLogBase {
  type: 'gpuPowerLimitChanged';
  reason: 'SLEEP_MODE_ENABLED' | 'SLEEP_MODE_DISABLED';
  device: string;
  limit: number;
  resetToDefault: boolean;
}

export interface EventLogBrightnessChanged extends EventLogBase {
  type: 'brightnessChanged';
  reason: 'SLEEP_MODE_ENABLED' | 'SLEEP_MODE_DISABLED';
  transition: boolean;
  value: number;
  transitionTime: number;
}

export interface EventLogAcceptedInviteRequest extends EventLogBase {
  type: 'acceptedInviteRequest';
  displayName: string;
  mode: 'DISABLED' | 'WHITELIST' | 'BLACKLIST';
}

export interface EventLogStatusChangedOnPlayerCountChange extends EventLogBase {
  type: 'statusChangedOnPlayerCountChange';
  reason: 'BELOW_LIMIT' | 'AT_LIMIT_OR_ABOVE';
  threshold: number;
  newStatus: UserStatus;
  oldStatus: UserStatus;
}

export interface EventLogSleepDetectorEnableCancelled extends EventLogBase {
  type: 'sleepDetectorEnableCancelled';
}
