import { ShutdownSequenceStage } from '../services/shutdown-automations.service';
import { LighthouseDevicePowerState } from './lighthouse-device';
import { SleepModeStatusChangeReason } from './sleep-mode';
import type { UserStatus } from 'vrchat/dist';
import { AudioDeviceParsedName, AudioDeviceType } from './audio-device';

export type EventLog = {
  version: 5;
  logs: EventLogEntry[];
};

export const EVENT_LOG_DEFAULT: EventLog = {
  version: 5,
  logs: [],
};

export type EventLogEntry =
  | EventLogSleepModeEnabled
  | EventLogSleepModeDisabled
  | EventLogTurnedOffOpenVRDevices
  | EventLogLighthouseSetPowerState
  | EventLogGpuPowerLimitChanged
  | EventLogSimpleBrightnessChanged
  | EventLogHardwareBrightnessChanged
  | EventLogSoftwareBrightnessChanged
  | EventLogAcceptedInviteRequest
  | EventLogStatusChangedOnPlayerCountChange
  | EventLogStatusChangedOnGeneralEvent
  | EventLogSleepDetectorEnableCancelled
  | EventLogRenderResolutionChanged
  | EventLogChaperoneFadeDistanceChanged
  | EventLogShutdownSequenceStarted
  | EventLogShutdownSequenceCancelled
  | EventLogWindowsPowerPolicySet
  | EventLogChangedVRChatMicMuteState
  | EventLogChangedSystemMicMuteState
  | EventLogChangedSystemMicControllerButtonBehavior
  | EventLogMsiAfterburnerProfileSet
  | EventLogChangedAudioDeviceVolume
  | EventLogMutedAudioDevice
  | EventLogUnmutedAudioDevice
  | EventLogBSBFanSpeedChanged
  | EventLogBSBLedChanged
  | EventLogVRChatAvatarChanged
  | EventLogCCTChanged;

export type EventLogDraft = Omit<EventLogEntry, 'time' | 'id'>;

export type EventLogType =
  | 'sleepModeEnabled'
  | 'sleepModeDisabled'
  | 'turnedOffOpenVRDevices'
  | 'lighthouseSetPowerState'
  | 'gpuPowerLimitChanged'
  | 'simpleBrightnessChanged'
  | 'hardwareBrightnessChanged'
  | 'softwareBrightnessChanged'
  | 'acceptedInviteRequest'
  | 'statusChangedOnPlayerCountChange'
  | 'statusChangedOnGeneralEvent'
  | 'sleepDetectorEnableCancelled'
  | 'renderResolutionChanged'
  | 'chaperoneFadeDistanceChanged'
  | 'shutdownSequenceStarted'
  | 'shutdownSequenceCancelled'
  | 'windowsPowerPolicySet'
  | 'changedVRChatMicMuteState'
  | 'changedSystemMicMuteState'
  | 'changedSystemMicControllerButtonBehavior'
  | 'msiAfterburnerProfileSet'
  | 'changedAudioDeviceVolume'
  | 'mutedAudioDevice'
  | 'unmutedAudioDevice'
  | 'bsbFanSpeedChanged'
  | 'bsbLedChanged'
  | 'cctChanged'
  | 'vrchatAvatarChanged';

export interface EventLogBase {
  id: string;
  type: EventLogType;
  time: number;
}

export type EventLogShutdownSequenceStartedReason =
  | 'MANUAL'
  | 'HOTKEY'
  | 'SLEEP_TRIGGER'
  | 'VRC_ALONE_TRIGGER'
  | 'MQTT';

export interface EventLogShutdownSequenceStarted extends EventLogBase {
  type: 'shutdownSequenceStarted';
  reason: EventLogShutdownSequenceStartedReason;
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
  reason: 'MANUAL' | 'OSC_CONTROL' | 'SLEEP_MODE_ENABLED' | 'CHARGING' | 'BATTERY_LEVEL' | 'HOTKEY';
  devices: 'CONTROLLER' | 'CONTROLLERS' | 'TRACKER' | 'TRACKERS' | 'ALL' | 'VARIOUS';
  batteryThreshold?: number;
}

export interface EventLogLighthouseSetPowerState extends EventLogBase {
  type: 'lighthouseSetPowerState';
  reason: 'MANUAL' | 'OYASUMI_START' | 'STEAMVR_START' | 'STEAMVR_STOP' | 'HOTKEY';
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

export interface EventLogHardwareBrightnessChanged extends EventLogBase {
  type: 'hardwareBrightnessChanged';
  reason:
    | 'SLEEP_MODE_ENABLED'
    | 'SLEEP_MODE_DISABLED'
    | 'SLEEP_PREPARATION'
    | 'AT_SUNSET'
    | 'AT_SUNRISE';
  transition: boolean;
  value: number;
  transitionTime: number;
}

export interface EventLogSoftwareBrightnessChanged extends EventLogBase {
  type: 'softwareBrightnessChanged';
  reason:
    | 'SLEEP_MODE_ENABLED'
    | 'SLEEP_MODE_DISABLED'
    | 'SLEEP_PREPARATION'
    | 'AT_SUNSET'
    | 'AT_SUNRISE';
  transition: boolean;
  value: number;
  transitionTime: number;
}

export interface EventLogSimpleBrightnessChanged extends EventLogBase {
  type: 'simpleBrightnessChanged';
  reason:
    | 'SLEEP_MODE_ENABLED'
    | 'SLEEP_MODE_DISABLED'
    | 'SLEEP_PREPARATION'
    | 'AT_SUNSET'
    | 'AT_SUNRISE';
  transition: boolean;
  value: number;
  transitionTime: number;
}

export interface EventLogCCTChanged extends EventLogBase {
  type: 'cctChanged';
  reason:
    | 'SLEEP_MODE_ENABLED'
    | 'SLEEP_MODE_DISABLED'
    | 'SLEEP_PREPARATION'
    | 'AT_SUNSET'
    | 'AT_SUNRISE';
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
  newStatus?: UserStatus;
  oldStatus: UserStatus;
  newStatusMessage?: string;
  oldStatusMessage: string;
}

export interface EventLogStatusChangedOnGeneralEvent extends EventLogBase {
  type: 'statusChangedOnGeneralEvent';
  reason: 'SLEEP_MODE_ENABLED' | 'SLEEP_MODE_DISABLED' | 'SLEEP_PREPARATION';
  newStatus?: UserStatus;
  oldStatus: UserStatus;
  newStatusMessage?: string;
  oldStatusMessage: string;
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

export interface EventLogWindowsPowerPolicySet extends EventLogBase {
  type: 'windowsPowerPolicySet';
  policyName: string;
  reason: 'SLEEP_MODE_ENABLED' | 'SLEEP_MODE_DISABLED';
}

export interface EventLogMsiAfterburnerProfileSet extends EventLogBase {
  type: 'msiAfterburnerProfileSet';
  profile: number;
  reason: 'SLEEP_MODE_ENABLED' | 'SLEEP_MODE_DISABLED';
}

export interface EventLogChangedVRChatMicMuteState extends EventLogBase {
  type: 'changedVRChatMicMuteState';
  muted: boolean;
  reason: 'SLEEP_MODE_ENABLED' | 'SLEEP_MODE_DISABLED' | 'SLEEP_PREPARATION';
}

export interface EventLogChangedSystemMicMuteState extends EventLogBase {
  type: 'changedSystemMicMuteState';
  muted: boolean;
  deviceName: string;
  reason: 'SLEEP_MODE_ENABLED' | 'SLEEP_MODE_DISABLED' | 'SLEEP_PREPARATION';
}

export interface EventLogChangedSystemMicControllerButtonBehavior extends EventLogBase {
  type: 'changedSystemMicControllerButtonBehavior';
  behavior: 'TOGGLE' | 'PUSH_TO_TALK';
  reason: 'SLEEP_MODE_ENABLED' | 'SLEEP_MODE_DISABLED' | 'SLEEP_PREPARATION';
}

export interface EventLogChangedAudioDeviceVolume extends EventLogBase {
  type: 'changedAudioDeviceVolume';
  volume: number;
  deviceName: AudioDeviceParsedName;
  deviceType: AudioDeviceType;
  reason: 'SLEEP_MODE_ENABLED' | 'SLEEP_MODE_DISABLED' | 'SLEEP_PREPARATION';
}

export interface EventLogMutedAudioDevice extends EventLogBase {
  type: 'mutedAudioDevice';
  deviceName: AudioDeviceParsedName;
  deviceType: AudioDeviceType;
  reason: 'SLEEP_MODE_ENABLED' | 'SLEEP_MODE_DISABLED' | 'SLEEP_PREPARATION';
}

export interface EventLogUnmutedAudioDevice extends EventLogBase {
  type: 'unmutedAudioDevice';
  deviceName: AudioDeviceParsedName;
  deviceType: AudioDeviceType;
  reason: 'SLEEP_MODE_ENABLED' | 'SLEEP_MODE_DISABLED' | 'SLEEP_PREPARATION';
}

export interface EventLogBSBFanSpeedChanged extends EventLogBase {
  type: 'bsbFanSpeedChanged';
  reason: 'SLEEP_MODE_ENABLED' | 'SLEEP_MODE_DISABLED' | 'SLEEP_PREPARATION';
  speed: number;
  effectiveSpeed: number;
}

export interface EventLogBSBLedChanged extends EventLogBase {
  type: 'bsbLedChanged';
  reason: 'SLEEP_MODE_ENABLED' | 'SLEEP_MODE_DISABLED' | 'SLEEP_PREPARATION';
  color: [number, number, number];
}

export interface EventLogVRChatAvatarChanged extends EventLogBase {
  type: 'vrchatAvatarChanged';
  avatarName: string;
  reason: 'SLEEP_MODE_ENABLED' | 'SLEEP_MODE_DISABLED' | 'SLEEP_PREPARATION';
}
