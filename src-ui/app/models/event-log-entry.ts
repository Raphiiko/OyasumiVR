import { ShutdownSequenceStage } from '../services/shutdown-automations.service';
import { LighthouseDevicePowerState } from './lighthouse-device';
import { SleepModeStatusChangeReason } from './sleep-mode';
import { UserStatus } from 'vrchat/dist';

export type EventLog = {
  version: 3;
  logs: EventLogEntry[];
};

export const EVENT_LOG_DEFAULT: EventLog = {
  version: 3,
  logs: [],
};

export type EventLogEntry =
  | EventLogSleepModeEnabled
  | EventLogSleepModeDisabled
  | EventLogTurnedOffOpenVRDevices
  | EventLogLighthouseSetPowerState
  | EventLogGpuPowerLimitChanged
  | EventLogDisplayBrightnessChanged
  | EventLogImageBrightnessChanged
  | EventLogAcceptedInviteRequest
  | EventLogStatusChangedOnPlayerCountChange
  | EventLogSleepDetectorEnableCancelled
  | EventLogRenderResolutionChanged
  | EventLogChaperoneFadeDistanceChanged
  | EventLogShutdownSequenceStarted
  | EventLogShutdownSequenceCancelled;

export type EventLogDraft = Omit<EventLogEntry, 'time' | 'id'>;

export type EventLogType =
  | 'sleepModeEnabled'
  | 'sleepModeDisabled'
  | 'turnedOffOpenVRDevices'
  | 'lighthouseSetPowerState'
  | 'gpuPowerLimitChanged'
  | 'displayBrightnessChanged'
  | 'imageBrightnessChanged'
  | 'acceptedInviteRequest'
  | 'statusChangedOnPlayerCountChange'
  | 'sleepDetectorEnableCancelled'
  | 'renderResolutionChanged'
  | 'chaperoneFadeDistanceChanged'
  | 'shutdownSequenceStarted'
  | 'shutdownSequenceCancelled';

export interface EventLogBase {
  id: string;
  type: EventLogType;

  time: number;
}

export interface EventLogShutdownSequenceStarted extends EventLogBase {
  type: 'shutdownSequenceStarted';
  reason: 'MANUAL' | 'SLEEP_TRIGGER';
  stages: ShutdownSequenceStage[];
}

export interface EventLogShutdownSequenceCancelled extends EventLogBase {
  type: 'shutdownSequenceCancelled';
  reason: 'MANUAL';
}

export interface EventLogSleepModeEnabled extends EventLogBase {
  type: 'sleepModeEnabled';
  reason: SleepModeStatusChangeReason;
}

export interface EventLogSleepModeDisabled extends EventLogBase {
  type: 'sleepModeDisabled';
  reason: SleepModeStatusChangeReason;
}

export interface EventLogTurnedOffOpenVRDevices extends EventLogBase {
  type: 'turnedOffOpenVRDevices';
  reason: 'MANUAL' | 'OSC_CONTROL' | 'SLEEP_MODE_ENABLED' | 'CHARGING';
  devices: 'CONTROLLER' | 'CONTROLLERS' | 'TRACKER' | 'TRACKERS' | 'ALL' | 'VARIOUS';
}

export interface EventLogLighthouseSetPowerState extends EventLogBase {
  type: 'lighthouseSetPowerState';
  reason: 'MANUAL' | 'OYASUMI_START' | 'STEAMVR_START' | 'STEAMVR_STOP';
  devices: 'ALL' | 'SINGLE';
  state: LighthouseDevicePowerState;
}

export interface EventLogGpuPowerLimitChanged extends EventLogBase {
  type: 'gpuPowerLimitChanged';
  reason: 'SLEEP_MODE_ENABLED' | 'SLEEP_MODE_DISABLED';
  device: string;
  limit: number;
  resetToDefault: boolean;
}

export interface EventLogDisplayBrightnessChanged extends EventLogBase {
  type: 'displayBrightnessChanged';
  reason: 'SLEEP_MODE_ENABLED' | 'SLEEP_MODE_DISABLED';
  transition: boolean;
  value: number;
  transitionTime: number;
}

export interface EventLogImageBrightnessChanged extends EventLogBase {
  type: 'imageBrightnessChanged';
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

export interface EventLogRenderResolutionChanged extends EventLogBase {
  type: 'renderResolutionChanged';
  reason: 'SLEEP_MODE_ENABLED' | 'SLEEP_MODE_DISABLED';
  resolution: number | null;
}

export interface EventLogChaperoneFadeDistanceChanged extends EventLogBase {
  type: 'chaperoneFadeDistanceChanged';
  reason: 'SLEEP_MODE_ENABLED' | 'SLEEP_MODE_DISABLED';
  fadeDistance: number;
}
