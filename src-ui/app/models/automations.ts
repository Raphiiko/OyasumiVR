import { OVRDeviceClass } from './ovr-device';
import { OscScript } from './osc-script';
import { SleepingPose } from './sleeping-pose';
import { UserStatus } from 'vrchat/dist';
import { AudioDeviceParsedName, AudioDeviceType } from './audio-device';
import { PersistedAvatar } from './vrchat';
import { FrameLimiterPresets } from '../services/frame-limiter.service';
import { getBuiltInNotificationSound, NotificationSound } from './notification-sounds';
import { DeviceSelection } from './device-manager';

export type AutomationType =
  | 'GPU_POWER_LIMITS'
  | 'MSI_AFTERBURNER'
  | 'SLEEP_MODE_ENABLE_FOR_SLEEP_DETECTOR'
  | 'SLEEP_MODE_ENABLE_AT_TIME'
  | 'SLEEP_MODE_ENABLE_AT_BATTERY_PERCENTAGE'
  | 'SLEEP_MODE_ENABLE_ON_CONTROLLERS_POWERED_OFF'
  | 'SLEEP_MODE_ENABLE_ON_HEART_RATE_CALM_PERIOD'
  | 'SLEEP_MODE_CHANGE_ON_STEAMVR_STATUS'
  | 'SLEEP_MODE_DISABLE_AT_TIME'
  | 'SLEEP_MODE_DISABLE_AFTER_TIME'
  | 'SLEEP_MODE_DISABLE_ON_DEVICE_POWER_ON'
  | 'SLEEP_MODE_DISABLE_ON_UPRIGHT_POSE'
  | 'SLEEP_MODE_DISABLE_ON_PLAYER_JOIN_OR_LEAVE'
  | 'DEVICE_POWER_AUTOMATIONS'
  | 'OSC_GENERAL'
  | 'SLEEPING_ANIMATIONS'
  | 'VRCHAT_MIC_MUTE_AUTOMATIONS'
  | 'BRIGHTNESS_AUTOMATIONS'
  | 'RENDER_RESOLUTION_ON_SLEEP_MODE_ENABLE'
  | 'RENDER_RESOLUTION_ON_SLEEP_MODE_DISABLE'
  | 'CHAPERONE_FADE_DISTANCE_ON_SLEEP_MODE_ENABLE'
  | 'CHAPERONE_FADE_DISTANCE_ON_SLEEP_MODE_DISABLE'
  | 'WINDOWS_POWER_POLICY_ON_SLEEP_MODE_ENABLE'
  | 'WINDOWS_POWER_POLICY_ON_SLEEP_MODE_DISABLE'
  | 'FRAME_LIMIT_AUTOMATIONS'
  | 'JOIN_NOTIFICATIONS'
  | 'AUDIO_DEVICE_AUTOMATIONS'
  | 'SHUTDOWN_AUTOMATIONS'
  | 'AUTO_ACCEPT_INVITE_REQUESTS'
  | 'CHANGE_STATUS_BASED_ON_PLAYER_COUNT'
  | 'CHANGE_STATUS_GENERAL_EVENTS'
  | 'SYSTEM_MIC_MUTE_AUTOMATIONS'
  | 'NIGHTMARE_DETECTION'
  | 'VRCHAT_AVATAR_AUTOMATIONS'
  | 'BIGSCREEN_BEYOND_FAN_CONTROL'
  | 'BIGSCREEN_BEYOND_RGB_CONTROL'
  | 'VRCHAT_GROUP_AUTOMATIONS'
  | 'RUN_AUTOMATIONS';

export interface AutomationConfigs {
  version: 18;
  // CORE SLEEP FUNCTIONALITY
  SLEEP_MODE_ENABLE_FOR_SLEEP_DETECTOR: SleepModeEnableForSleepDetectorAutomationConfig;
  SLEEP_MODE_ENABLE_AT_TIME: SleepModeEnableAtTimeAutomationConfig;
  SLEEP_MODE_ENABLE_AT_BATTERY_PERCENTAGE: SleepModeEnableAtBatteryPercentageAutomationConfig;
  SLEEP_MODE_ENABLE_ON_CONTROLLERS_POWERED_OFF: SleepModeEnableAtControllersPoweredOffAutomationConfig;
  SLEEP_MODE_ENABLE_ON_HEART_RATE_CALM_PERIOD: SleepModeEnableOnHeartRateCalmPeriodAutomationConfig;
  SLEEP_MODE_CHANGE_ON_STEAMVR_STATUS: SleepModeChangeOnSteamVRStatusAutomationConfig;
  SLEEP_MODE_DISABLE_AT_TIME: SleepModeDisableAtTimeAutomationConfig;
  SLEEP_MODE_DISABLE_AFTER_TIME: SleepModeDisableAfterTimeAutomationConfig;
  SLEEP_MODE_DISABLE_ON_DEVICE_POWER_ON: SleepModeDisableOnDevicePowerOnAutomationConfig;
  SLEEP_MODE_DISABLE_ON_UPRIGHT_POSE: SleepModeDisableOnUprightPoseAutomationConfig;
  SLEEP_MODE_DISABLE_ON_PLAYER_JOIN_OR_LEAVE: SleepModeDisableOnPlayerJoinOrLeaveAutomationConfig;
  NIGHTMARE_DETECTION: NightmareDetectionAutomationsConfig;

  // DEVICE MANAGEMENT
  DEVICE_POWER_AUTOMATIONS: DevicePowerAutomationsConfig;

  // DISPLAY & VISUAL
  BRIGHTNESS_AUTOMATIONS: BrightnessAutomationsConfig;
  RENDER_RESOLUTION_ON_SLEEP_MODE_ENABLE: RenderResolutionOnSleepModeAutomationConfig;
  RENDER_RESOLUTION_ON_SLEEP_MODE_DISABLE: RenderResolutionOnSleepModeAutomationConfig;
  CHAPERONE_FADE_DISTANCE_ON_SLEEP_MODE_ENABLE: ChaperoneFadeDistanceOnSleepModeAutomationConfig;
  CHAPERONE_FADE_DISTANCE_ON_SLEEP_MODE_DISABLE: ChaperoneFadeDistanceOnSleepModeAutomationConfig;

  // AUDIO & COMMUNICATION
  AUDIO_DEVICE_AUTOMATIONS: AudioDeviceAutomationsConfig;
  SYSTEM_MIC_MUTE_AUTOMATIONS: SystemMicMuteAutomationsConfig;
  JOIN_NOTIFICATIONS: JoinNotificationsAutomationsConfig;

  // VR APPLICATION INTEGRATION
  OSC_GENERAL: OscGeneralAutomationConfig;
  SLEEPING_ANIMATIONS: SleepingAnimationsAutomationConfig;
  VRCHAT_MIC_MUTE_AUTOMATIONS: VRChatMicMuteAutomationsConfig;
  VRCHAT_AVATAR_AUTOMATIONS: VRChatAvatarAutomationsConfig;
  CHANGE_STATUS_BASED_ON_PLAYER_COUNT: ChangeStatusBasedOnPlayerCountAutomationConfig;
  CHANGE_STATUS_GENERAL_EVENTS: ChangeStatusGeneralEventsAutomationConfig;
  AUTO_ACCEPT_INVITE_REQUESTS: AutoAcceptInviteRequestsAutomationConfig;
  VRCHAT_GROUP_AUTOMATIONS: VRChatGroupAutomationsConfig;

  // SYSTEM CONTROL
  WINDOWS_POWER_POLICY_ON_SLEEP_MODE_ENABLE: WindowsPowerPolicyOnSleepModeAutomationConfig;
  WINDOWS_POWER_POLICY_ON_SLEEP_MODE_DISABLE: WindowsPowerPolicyOnSleepModeAutomationConfig;
  FRAME_LIMIT_AUTOMATIONS: FrameLimitAutomationsConfig;
  SHUTDOWN_AUTOMATIONS: ShutdownAutomationsConfig;
  RUN_AUTOMATIONS: RunAutomationsConfig;

  // HARDWARE SPECIFIC
  GPU_POWER_LIMITS: GPUPowerLimitsAutomationConfig;
  MSI_AFTERBURNER: MSIAfterburnerAutomationConfig;
  BIGSCREEN_BEYOND_FAN_CONTROL: BigscreenBeyondFanControlAutomationsConfig;
  BIGSCREEN_BEYOND_RGB_CONTROL: BigscreenBeyondRgbControlAutomationsConfig;
}

export interface AutomationConfig {
  enabled: boolean;
}

//
// Automation configs
//

// BRIGHTNESS AUTOMATIONS
export const BrightnessEvents = [
  'SLEEP_MODE_ENABLE',
  'SLEEP_MODE_DISABLE',
  'SLEEP_PREPARATION',
  'AT_SUNSET',
  'AT_SUNRISE',
  'HMD_CONNECT',
] as const;
export type BrightnessEvent = (typeof BrightnessEvents)[number];

export type BrightnessAutomationsConfig = AutomationConfig & {
  advancedMode: boolean;
  AT_SUNSET: SunBrightnessEventAutomationConfig;
  AT_SUNRISE: SunBrightnessEventAutomationConfig;
  SLEEP_PREPARATION: GenericBrightnessEventAutomationConfig;
  SLEEP_MODE_ENABLE: GenericBrightnessEventAutomationConfig;
  SLEEP_MODE_DISABLE: GenericBrightnessEventAutomationConfig;
  HMD_CONNECT: GenericBrightnessEventAutomationConfig;
};

export type BrightnessEventAutomationConfig =
  | GenericBrightnessEventAutomationConfig
  | SunBrightnessEventAutomationConfig;

export interface GenericBrightnessEventAutomationConfig extends AutomationConfig {
  type?: undefined;
  changeBrightness: boolean;
  changeColorTemperature: boolean;
  brightness: number;
  softwareBrightness: number;
  hardwareBrightness: number;
  transition: boolean;
  transitionTime: number;
  colorTemperature: number;
}

export interface SunBrightnessEventAutomationConfig extends Omit<
  GenericBrightnessEventAutomationConfig,
  'type'
> {
  type: 'SUN';
  onlyWhenSleepDisabled: boolean;
  activationTime: string | null;
  autoUpdateTime: boolean;
}

// RESOLUTION AUTOMATIONS
export interface RenderResolutionOnSleepModeAutomationConfig extends AutomationConfig {
  resolution: number | null;
}

// CHAPERONE AUTOMATIONS
export interface ChaperoneFadeDistanceOnSleepModeAutomationConfig extends AutomationConfig {
  fadeDistance: number;
}

// GPU AUTOMATIONS
export interface GPUPowerLimitsAutomationConfig extends AutomationConfig {
  selectedDeviceId: string | null;
  onSleepEnable: {
    enabled: boolean;
    powerLimit?: number;
    resetToDefault: boolean;
  };
  onSleepDisable: {
    enabled: boolean;
    powerLimit?: number;
    resetToDefault: boolean;
  };
}

export interface MSIAfterburnerAutomationConfig extends AutomationConfig {
  msiAfterburnerPath: string;
  onSleepEnableProfile: number;
  onSleepDisableProfile: number;
}

// SLEEP MODE AUTOMATIONS
export interface SleepModeEnableForSleepDetectorAutomationConfig extends AutomationConfig {
  calibrationValue: number;
  sensitivity: 'LOWEST' | 'LOW' | 'MEDIUM' | 'HIGH' | 'HIGHEST';
  sleepCheck: boolean;
  detectionWindowMinutes: number;
  activationWindow: boolean;
  activationWindowStart: [number, number];
  activationWindowEnd: [number, number];
  considerControllerPresence: boolean;
  considerSleepingPose: boolean;
}

export interface SleepModeEnableAtTimeAutomationConfig extends AutomationConfig {
  time: string | null;
}

export interface SleepModeEnableAtBatteryPercentageAutomationConfig extends AutomationConfig {
  triggerClasses: OVRDeviceClass[];
  threshold: number;
}

export type SleepModeEnableAtControllersPoweredOffAutomationConfig = AutomationConfig;

export interface SleepModeEnableOnHeartRateCalmPeriodAutomationConfig extends AutomationConfig {
  heartRateThreshold: number;
  periodDuration: number;
}

export interface SleepModeChangeOnSteamVRStatusAutomationConfig extends AutomationConfig {
  disableOnSteamVRStop: boolean;
}

export interface SleepModeDisableAtTimeAutomationConfig extends AutomationConfig {
  time: string | null;
}

export interface SleepModeDisableAfterTimeAutomationConfig extends AutomationConfig {
  duration: string | null;
}

export interface SleepModeDisableOnDevicePowerOnAutomationConfig extends AutomationConfig {
  triggerClasses: OVRDeviceClass[];
}

export interface SleepModeDisableOnUprightPoseAutomationConfig extends AutomationConfig {
  duration: number;
}

export interface SleepModeDisableOnPlayerJoinOrLeaveAutomationConfig extends AutomationConfig {
  joinMode: JoinNotificationsMode;
  leaveMode: JoinNotificationsMode;
  playerIds: string[];
  onlyWhenPreviouslyAlone: boolean;
  onlyWhenLeftAlone: boolean;
}

// DEVICE POWER AUTOMATIONS
export interface DevicePowerAutomationsConfig extends AutomationConfig {
  turnOffDevicesOnSleepModeEnable: DeviceSelection;
  turnOffDevicesOnSleepModeDisable: DeviceSelection;
  turnOffDevicesOnSleepPreparation: DeviceSelection;
  turnOffDevicesWhenCharging: DeviceSelection;
  turnOffDevicesBelowBatteryLevel: DeviceSelection;
  turnOffDevicesBelowBatteryLevel_threshold: number;
  turnOffDevicesBelowBatteryLevel_onlyWhileAsleep: boolean;
  turnOffDevicesOnSteamVRStop: DeviceSelection;
  turnOnDevicesOnSteamVRStart: DeviceSelection;
  turnOnDevicesOnOyasumiStart: DeviceSelection;
  turnOnDevicesOnSleepModeDisable: DeviceSelection;
}

// OSC AUTOMATIONS
export interface OscGeneralAutomationConfig extends AutomationConfig {
  onSleepModeEnable?: OscScript;
  onSleepModeDisable?: OscScript;
  onSleepPreparation?: OscScript;
}

export interface SleepingAnimationsAutomationConfig extends AutomationConfig {
  preset: string | null;
  oscScripts: {
    [key in SleepingPose | 'FOOT_LOCK' | 'FOOT_UNLOCK']?: OscScript;
  };
  onlyIfSleepModeEnabled: boolean;
  lockFeetOnSleepModeEnable: boolean;
  unlockFeetOnSleepModeDisable: boolean;
  unlockFeetOnAutomationDisable: boolean;
  releaseFootLockOnPoseChange: boolean;
  footLockReleaseWindow: number;
  enableAvatarReloadOnFBTDisableWorkaround: boolean;
}

export type VRChatVoiceMode = 'TOGGLE' | 'PUSH_TO_TALK';
export type VRChatMicMuteStateOption = 'MUTE' | 'UNMUTE' | 'NONE';

export interface VRChatMicMuteAutomationsConfig extends AutomationConfig {
  onSleepModeEnable: VRChatMicMuteStateOption;
  onSleepModeDisable: VRChatMicMuteStateOption;
  onSleepPreparation: VRChatMicMuteStateOption;
}

// STATUS AUTOMATIONS
export interface ChangeStatusBasedOnPlayerCountAutomationConfig extends AutomationConfig {
  limit: number;
  statusBelowLimit: UserStatus;
  statusBelowLimitEnabled: boolean;
  statusMessageBelowLimit: string;
  statusMessageBelowLimitEnabled: boolean;
  statusAtLimitOrAbove: UserStatus;
  statusAtLimitOrAboveEnabled: boolean;
  statusMessageAtLimitOrAbove: string;
  statusMessageAtLimitOrAboveEnabled: boolean;
  onlyIfSleepModeEnabled: boolean;
}

export interface ChangeStatusGeneralEventsAutomationConfig extends AutomationConfig {
  changeStatusOnSleepModeEnable: boolean;
  statusOnSleepModeEnable: UserStatus;
  changeStatusMessageOnSleepModeEnable: boolean;
  statusMessageOnSleepModeEnable: string;
  changeStatusOnSleepModeDisable: boolean;
  statusOnSleepModeDisable: UserStatus;
  changeStatusMessageOnSleepModeDisable: boolean;
  statusMessageOnSleepModeDisable: string;
  changeStatusOnSleepPreparation: boolean;
  statusOnSleepPreparation: UserStatus;
  changeStatusMessageOnSleepPreparation: boolean;
  statusMessageOnSleepPreparation: string;
}

// WINDOWS POWER POLICY AUTOMATIONS
export interface WindowsPowerPolicyOnSleepModeAutomationConfig extends AutomationConfig {
  powerPolicy?: string;
}

// MISCELLANEOUS AUTOMATIONS

export interface FrameLimitAutomationsConfig extends AutomationConfig {
  configs: FrameLimitAutomationsAppConfig[];
}

export interface FrameLimitAutomationsAppConfig {
  appId: number;
  appLabel: string;
  onSleepEnable: FrameLimitConfigOption;
  onSleepDisable: FrameLimitConfigOption;
  onSleepPreparation: FrameLimitConfigOption;
}

export const FrameLimitConfigOptions = [5, 4, 3, 2, 1, 0, 'AUTO', 'DISABLED'];

export type FrameLimitConfigOption = (typeof FrameLimitConfigOptions)[number];

export type JoinNotificationsMode = 'EVERYONE' | 'FRIEND' | 'WHITELIST' | 'BLACKLIST' | 'DISABLED';

export interface JoinNotificationsAutomationsConfig extends AutomationConfig {
  playerIds: string[];
  onlyDuringSleepMode: boolean;
  onlyWhenPreviouslyAlone: boolean;
  onlyWhenLeftAlone: boolean;
  joinNotification: JoinNotificationsMode;
  leaveNotification: JoinNotificationsMode;
  joinSoundMode: JoinNotificationsMode;
  leaveSoundMode: JoinNotificationsMode;
  joinSound: SoundEffectConfig;
  leaveSound: SoundEffectConfig;
}

export type AudioVolumeAutomationType = 'SET_VOLUME' | 'MUTE' | 'UNMUTE';
export type AudioVolumeAutomation =
  | MuteAudioVolumeAutomation
  | UnmuteAudioVolumeAutomation
  | SetAudioVolumeAutomation;

export interface BaseAudioVolumeAutomation {
  type: AudioVolumeAutomationType;
  applyOnStart: boolean;
  audioDeviceRef: {
    persistentId: string;
    type: AudioDeviceType;
    name: AudioDeviceParsedName;
  };
}

export interface MuteAudioVolumeAutomation extends BaseAudioVolumeAutomation {
  type: 'MUTE';
}

export interface UnmuteAudioVolumeAutomation extends BaseAudioVolumeAutomation {
  type: 'UNMUTE';
}

export interface SetAudioVolumeAutomation extends BaseAudioVolumeAutomation {
  type: 'SET_VOLUME';
  volume: number;
}

export interface AudioDeviceAutomationsConfig extends AutomationConfig {
  onSleepEnableAutomations: AudioVolumeAutomation[];
  onSleepDisableAutomations: AudioVolumeAutomation[];
  onSleepPreparationAutomations: AudioVolumeAutomation[];
}

export type SystemMicMuteControllerBindingBehavior = 'TOGGLE' | 'PUSH_TO_TALK';

export type SystemMicMuteStateOption = 'MUTE' | 'UNMUTE' | 'NONE';

export type VRChatMicrophoneWorldJoinBehaviour = 'MUTE' | 'UNMUTE' | 'KEEP';

export interface SystemMicMuteAutomationsConfig extends AutomationConfig {
  audioDevicePersistentId: string | null;
  onSleepModeEnableState: SystemMicMuteStateOption;
  onSleepModeDisableState: SystemMicMuteStateOption;
  onSleepPreparationState: SystemMicMuteStateOption;
  overlayMuteIndicator: boolean;
  overlayMuteIndicatorOpacity: number;
  overlayMuteIndicatorFade: boolean;
  controllerBinding: boolean;
  controllerBindingBehavior: SystemMicMuteControllerBindingBehavior;
  muteSoundVolume: number;
  onSleepModeEnableControllerBindingBehavior: SystemMicMuteControllerBindingBehavior | 'NONE';
  onSleepModeDisableControllerBindingBehavior: SystemMicMuteControllerBindingBehavior | 'NONE';
  onSleepPreparationControllerBindingBehavior: SystemMicMuteControllerBindingBehavior | 'NONE';
  voiceActivationMode: 'VRCHAT' | 'HARDWARE';
  hardwareVoiceActivationThreshold: number;
  vrchatWorldJoinBehaviour: VRChatMicrophoneWorldJoinBehaviour;
}

export interface AutoAcceptInviteRequestsAutomationConfig extends AutomationConfig {
  onlyIfSleepModeEnabled: boolean;
  onlyBelowPlayerCount: number;
  onlyBelowPlayerCountEnabled: boolean;
  listMode: 'DISABLED' | 'WHITELIST' | 'BLACKLIST';
  playerIds: string[];
  presetOnSleepEnable: string | null;
  presetOnSleepDisable: string | null;
  presetOnSleepPreparation: string | null;
  acceptMessageEnabled: boolean;
  declineOnRequest: 'DISABLED' | 'WHEN_SLEEPING' | 'ALWAYS';
  declineInvitesWhileAsleep: boolean;
  acceptInviteRequestMessage: string;
  declineInviteRequestMessage: string;
  declineInviteMessage: string;
  playSoundOnInviteRequest: SoundEffectConfig;
  playSoundOnInviteRequest_onlyWhenAsleep: boolean;
  playSoundOnInviteRequest_onlyWhenUnhandled: boolean;
  playSoundOnInvite: SoundEffectConfig;
  playSoundOnInvite_onlyWhenAsleep: boolean;
}

export interface VRChatGroupAutomationsConfig extends AutomationConfig {
  representGroupIdOnSleepModeEnable: string | 'DONT_CHANGE' | 'CLEAR_GROUP';
  representGroupIdOnSleepModeDisable: string | 'DONT_CHANGE' | 'CLEAR_GROUP';
  representGroupIdOnSleepPreparation: string | 'DONT_CHANGE' | 'CLEAR_GROUP';
}

export type PowerDownWindowsMode = 'SHUTDOWN' | 'REBOOT' | 'SLEEP' | 'HIBERNATE' | 'LOGOUT';

export interface ShutdownAutomationsConfig extends AutomationConfig {
  triggersEnabled: boolean;
  triggerOnSleep: boolean;
  triggerOnSleepDuration: number;
  triggerOnSleepActivationWindow: boolean;
  triggerOnSleepActivationWindowStart: [number, number];
  triggerOnSleepActivationWindowEnd: [number, number];
  triggerWhenAlone: boolean;
  triggerWhenAloneDuration: number;
  triggerWhenAloneOnlyWhenSleepModeActive: boolean;
  triggerWhenAloneActivationWindow: boolean;
  triggerWhenAloneActivationWindowStart: [number, number];
  triggerWhenAloneActivationWindowEnd: [number, number];
  quitSteamVR: boolean;
  turnOffDevices: DeviceSelection;
  powerDownWindows: boolean;
  powerDownWindowsMode: PowerDownWindowsMode;
}

export interface NightmareDetectionAutomationsConfig extends AutomationConfig {
  heartRateThreshold: number;
  periodDuration: number;
  disableSleepMode: boolean;
  sound: SoundEffectConfig;
}

export interface BigscreenBeyondFanControlAutomationsConfig extends AutomationConfig {
  onSleepEnable: boolean;
  onSleepEnableFanSpeed: number;
  onSleepDisable: boolean;
  onSleepDisableFanSpeed: number;
  onSleepPreparation: boolean;
  onSleepPreparationFanSpeed: number;
  allowUnsafeFanSpeed: boolean;
}

export interface BigscreenBeyondRgbControlAutomationsConfig extends AutomationConfig {
  onSleepEnable: boolean;
  onSleepEnableRgb: [number, number, number];
  onSleepDisable: boolean;
  onSleepDisableRgb: [number, number, number];
  onSleepPreparation: boolean;
  onSleepPreparationRgb: [number, number, number];
}

export interface VRChatAvatarAutomationsConfig extends AutomationConfig {
  onSleepEnable: PersistedAvatar | null;
  onSleepDisable: PersistedAvatar | null;
  onSleepPreparation: PersistedAvatar | null;
}

export interface SoundEffectConfig {
  sound: NotificationSound;
  volume: number;
  enabled: boolean;
}

export interface RunAutomationsConfig extends AutomationConfig {
  onSleepModeEnable: boolean;
  onSleepModeEnableCommands: string;
  onSleepModeDisable: boolean;
  onSleepModeDisableCommands: string;
  onSleepPreparation: boolean;
  onSleepPreparationCommands: string;
  runAutomationsCryptoKey?: string;
}

//
// DEFAULT
//

export const AUTOMATION_CONFIGS_DEFAULT: AutomationConfigs = {
  version: 18,
  // CORE SLEEP FUNCTIONALITY
  SLEEP_MODE_ENABLE_FOR_SLEEP_DETECTOR: {
    enabled: false,
    calibrationValue: 0.01,
    sensitivity: 'MEDIUM',
    sleepCheck: true,
    detectionWindowMinutes: 15,
    activationWindow: false,
    activationWindowStart: [23, 0],
    activationWindowEnd: [7, 0],
    considerControllerPresence: true,
    considerSleepingPose: true,
  },
  SLEEP_MODE_ENABLE_AT_TIME: {
    enabled: false,
    time: null,
  },
  SLEEP_MODE_ENABLE_AT_BATTERY_PERCENTAGE: {
    enabled: false,
    triggerClasses: ['GenericTracker', 'Controller'],
    threshold: 50,
  },
  SLEEP_MODE_ENABLE_ON_CONTROLLERS_POWERED_OFF: {
    enabled: false,
  },
  SLEEP_MODE_ENABLE_ON_HEART_RATE_CALM_PERIOD: {
    enabled: false,
    heartRateThreshold: 60,
    periodDuration: 120 * 1000,
  },
  SLEEP_MODE_CHANGE_ON_STEAMVR_STATUS: {
    enabled: true,
    disableOnSteamVRStop: false,
  },
  SLEEP_MODE_DISABLE_AT_TIME: {
    enabled: false,
    time: null,
  },
  SLEEP_MODE_DISABLE_AFTER_TIME: {
    enabled: false,
    duration: null,
  },
  SLEEP_MODE_DISABLE_ON_DEVICE_POWER_ON: {
    enabled: false,
    triggerClasses: ['GenericTracker', 'Controller'],
  },
  SLEEP_MODE_DISABLE_ON_UPRIGHT_POSE: {
    enabled: false,
    duration: 5000,
  },
  SLEEP_MODE_DISABLE_ON_PLAYER_JOIN_OR_LEAVE: {
    enabled: false,
    joinMode: 'EVERYONE',
    leaveMode: 'DISABLED',
    playerIds: [],
    onlyWhenPreviouslyAlone: false,
    onlyWhenLeftAlone: false,
  },
  NIGHTMARE_DETECTION: {
    enabled: false,
    heartRateThreshold: 130,
    periodDuration: 60 * 1000,
    disableSleepMode: false,
    sound: {
      sound: getBuiltInNotificationSound('gentle_chime_long'),
      volume: 100,
      enabled: true,
    },
  },

  // DEVICE MANAGEMENT
  DEVICE_POWER_AUTOMATIONS: {
    enabled: true,
    turnOffDevicesOnSleepModeEnable: {
      devices: [],
      types: [],
      tagIds: [],
    },
    turnOffDevicesOnSleepModeDisable: {
      devices: [],
      types: [],
      tagIds: [],
    },
    turnOffDevicesOnSleepPreparation: {
      devices: [],
      types: [],
      tagIds: [],
    },
    turnOffDevicesWhenCharging: {
      devices: [],
      types: [],
      tagIds: [],
    },
    turnOffDevicesBelowBatteryLevel: {
      devices: [],
      types: [],
      tagIds: [],
    },
    turnOffDevicesBelowBatteryLevel_threshold: 50,
    turnOffDevicesBelowBatteryLevel_onlyWhileAsleep: false,
    turnOffDevicesOnSteamVRStop: {
      devices: [],
      types: [],
      tagIds: [],
    },
    turnOnDevicesOnSteamVRStart: {
      devices: [],
      types: [],
      tagIds: [],
    },
    turnOnDevicesOnOyasumiStart: {
      devices: [],
      types: [],
      tagIds: [],
    },
    turnOnDevicesOnSleepModeDisable: {
      devices: [],
      types: [],
      tagIds: [],
    },
  },
  // DISPLAY & VISUAL
  BRIGHTNESS_AUTOMATIONS: {
    enabled: true,
    advancedMode: false,
    AT_SUNSET: {
      type: 'SUN',
      enabled: false,
      changeBrightness: true,
      changeColorTemperature: true,
      brightness: 80,
      softwareBrightness: 80,
      hardwareBrightness: 100,
      transition: true,
      transitionTime: 10000,
      colorTemperature: 1800,
      onlyWhenSleepDisabled: true,
      activationTime: null,
      autoUpdateTime: true,
    },
    AT_SUNRISE: {
      type: 'SUN',
      enabled: false,
      changeBrightness: true,
      changeColorTemperature: true,
      brightness: 100,
      softwareBrightness: 100,
      hardwareBrightness: 100,
      transition: true,
      transitionTime: 10000,
      colorTemperature: 6600,
      onlyWhenSleepDisabled: true,
      activationTime: null,
      autoUpdateTime: true,
    },
    SLEEP_PREPARATION: {
      enabled: false,
      changeBrightness: true,
      changeColorTemperature: true,
      brightness: 50,
      softwareBrightness: 50,
      hardwareBrightness: 100,
      transition: true,
      transitionTime: 10000,
      colorTemperature: 3500,
    },
    SLEEP_MODE_ENABLE: {
      enabled: false,
      changeBrightness: true,
      changeColorTemperature: true,
      brightness: 20,
      softwareBrightness: 20,
      hardwareBrightness: 100,
      transition: true,
      transitionTime: 10000,
      colorTemperature: 1800,
    },
    SLEEP_MODE_DISABLE: {
      enabled: false,
      changeBrightness: true,
      changeColorTemperature: true,
      brightness: 100,
      softwareBrightness: 100,
      hardwareBrightness: 100,
      transition: true,
      transitionTime: 10000,
      colorTemperature: 6600,
    },
    HMD_CONNECT: {
      enabled: false,
      changeBrightness: true,
      changeColorTemperature: true,
      brightness: 100,
      softwareBrightness: 100,
      hardwareBrightness: 100,
      transition: true,
      transitionTime: 10000,
      colorTemperature: 6600,
    },
  },
  RENDER_RESOLUTION_ON_SLEEP_MODE_ENABLE: {
    enabled: false,
    resolution: 50,
  },
  RENDER_RESOLUTION_ON_SLEEP_MODE_DISABLE: {
    enabled: false,
    resolution: null,
  },
  CHAPERONE_FADE_DISTANCE_ON_SLEEP_MODE_ENABLE: {
    enabled: false,
    fadeDistance: 0.0,
  },
  CHAPERONE_FADE_DISTANCE_ON_SLEEP_MODE_DISABLE: {
    enabled: false,
    fadeDistance: 0.7,
  },

  // AUDIO & COMMUNICATION
  AUDIO_DEVICE_AUTOMATIONS: {
    enabled: false,
    onSleepEnableAutomations: [],
    onSleepDisableAutomations: [],
    onSleepPreparationAutomations: [],
  },
  SYSTEM_MIC_MUTE_AUTOMATIONS: {
    enabled: false,
    audioDevicePersistentId: null,
    onSleepModeEnableState: 'NONE',
    onSleepModeDisableState: 'NONE',
    onSleepPreparationState: 'NONE',
    overlayMuteIndicator: false,
    overlayMuteIndicatorOpacity: 80,
    overlayMuteIndicatorFade: true,
    controllerBinding: false,
    controllerBindingBehavior: 'TOGGLE',
    muteSoundVolume: 100,
    onSleepModeEnableControllerBindingBehavior: 'NONE',
    onSleepModeDisableControllerBindingBehavior: 'NONE',
    onSleepPreparationControllerBindingBehavior: 'NONE',
    voiceActivationMode: 'VRCHAT',
    hardwareVoiceActivationThreshold: 4,
    vrchatWorldJoinBehaviour: 'KEEP',
  },
  JOIN_NOTIFICATIONS: {
    enabled: false,
    playerIds: [],
    onlyDuringSleepMode: false,
    onlyWhenPreviouslyAlone: false,
    onlyWhenLeftAlone: false,
    joinNotification: 'WHITELIST',
    leaveNotification: 'DISABLED',
    joinSoundMode: 'WHITELIST',
    leaveSoundMode: 'DISABLED',
    joinSound: {
      sound: getBuiltInNotificationSound('ripple'),
      volume: 100,
      enabled: true,
    },
    leaveSound: {
      sound: getBuiltInNotificationSound('pulse'),
      volume: 100,
      enabled: true,
    },
  },
  // VR APPLICATION INTEGRATION
  OSC_GENERAL: {
    enabled: true,
  },
  SLEEPING_ANIMATIONS: {
    enabled: false,
    preset: null,
    onlyIfSleepModeEnabled: true,
    lockFeetOnSleepModeEnable: true,
    unlockFeetOnSleepModeDisable: true,
    unlockFeetOnAutomationDisable: true,
    releaseFootLockOnPoseChange: true,
    footLockReleaseWindow: 600,
    enableAvatarReloadOnFBTDisableWorkaround: false,
    oscScripts: {},
  },
  VRCHAT_MIC_MUTE_AUTOMATIONS: {
    enabled: true,
    onSleepModeEnable: 'NONE',
    onSleepModeDisable: 'NONE',
    onSleepPreparation: 'NONE',
  },
  VRCHAT_AVATAR_AUTOMATIONS: {
    enabled: true,
    onSleepEnable: null,
    onSleepDisable: null,
    onSleepPreparation: null,
  },
  CHANGE_STATUS_BASED_ON_PLAYER_COUNT: {
    enabled: false,
    limit: 2,
    statusBelowLimit: UserStatus.JoinMe,
    statusBelowLimitEnabled: true,
    statusMessageBelowLimit: '',
    statusMessageBelowLimitEnabled: false,
    statusAtLimitOrAbove: UserStatus.Busy,
    statusAtLimitOrAboveEnabled: true,
    statusMessageAtLimitOrAbove: '',
    statusMessageAtLimitOrAboveEnabled: false,
    onlyIfSleepModeEnabled: false,
  },
  CHANGE_STATUS_GENERAL_EVENTS: {
    enabled: true,
    changeStatusOnSleepModeEnable: false,
    statusOnSleepModeEnable: UserStatus.AskMe,
    changeStatusMessageOnSleepModeEnable: false,
    statusMessageOnSleepModeEnable: '',
    changeStatusOnSleepModeDisable: false,
    statusOnSleepModeDisable: UserStatus.Active,
    changeStatusMessageOnSleepModeDisable: false,
    statusMessageOnSleepModeDisable: '',
    changeStatusOnSleepPreparation: false,
    statusOnSleepPreparation: UserStatus.JoinMe,
    changeStatusMessageOnSleepPreparation: false,
    statusMessageOnSleepPreparation: '',
  },
  AUTO_ACCEPT_INVITE_REQUESTS: {
    enabled: false,
    onlyIfSleepModeEnabled: false,
    onlyBelowPlayerCount: 2,
    onlyBelowPlayerCountEnabled: false,
    listMode: 'WHITELIST',
    playerIds: [],
    presetOnSleepEnable: null,
    presetOnSleepDisable: null,
    presetOnSleepPreparation: null,
    acceptMessageEnabled: true,
    declineOnRequest: 'DISABLED',
    declineInvitesWhileAsleep: false,
    acceptInviteRequestMessage: '',
    declineInviteRequestMessage: '',
    declineInviteMessage: '',
    playSoundOnInviteRequest: {
      sound: getBuiltInNotificationSound('gentle_chime'),
      volume: 100,
      enabled: false,
    },
    playSoundOnInviteRequest_onlyWhenAsleep: false,
    playSoundOnInviteRequest_onlyWhenUnhandled: false,
    playSoundOnInvite: {
      sound: getBuiltInNotificationSound('gentle_chime'),
      volume: 100,
      enabled: false,
    },
    playSoundOnInvite_onlyWhenAsleep: false,
  },
  VRCHAT_GROUP_AUTOMATIONS: {
    enabled: true,
    representGroupIdOnSleepModeEnable: 'DONT_CHANGE',
    representGroupIdOnSleepModeDisable: 'DONT_CHANGE',
    representGroupIdOnSleepPreparation: 'DONT_CHANGE',
  },

  // SYSTEM CONTROL
  WINDOWS_POWER_POLICY_ON_SLEEP_MODE_ENABLE: {
    enabled: false,
  },
  WINDOWS_POWER_POLICY_ON_SLEEP_MODE_DISABLE: {
    enabled: false,
  },
  FRAME_LIMIT_AUTOMATIONS: {
    enabled: true,
    configs: [
      {
        appId: FrameLimiterPresets[0].appId,
        appLabel: FrameLimiterPresets[0].appLabel,
        onSleepEnable: 'DISABLED',
        onSleepDisable: 'DISABLED',
        onSleepPreparation: 'DISABLED',
      },
    ],
  },
  SHUTDOWN_AUTOMATIONS: {
    enabled: true,
    triggersEnabled: true,
    triggerOnSleep: false,
    triggerOnSleepDuration: 15 * 60 * 1000,
    triggerOnSleepActivationWindow: false,
    triggerOnSleepActivationWindowStart: [23, 0],
    triggerOnSleepActivationWindowEnd: [7, 0],
    triggerWhenAlone: false,
    triggerWhenAloneDuration: 15 * 60 * 1000,
    triggerWhenAloneOnlyWhenSleepModeActive: true,
    triggerWhenAloneActivationWindow: false,
    triggerWhenAloneActivationWindowStart: [23, 0],
    triggerWhenAloneActivationWindowEnd: [7, 0],
    quitSteamVR: true,
    turnOffDevices: {
      devices: [],
      types: [],
      tagIds: [],
    },
    powerDownWindows: true,
    powerDownWindowsMode: 'SHUTDOWN',
  },
  RUN_AUTOMATIONS: {
    enabled: true,
    onSleepModeEnable: false,
    onSleepModeDisable: false,
    onSleepPreparation: false,
    onSleepModeEnableCommands: '',
    onSleepModeDisableCommands: '',
    onSleepPreparationCommands: '',
  },
  // HARDWARE SPECIFIC
  GPU_POWER_LIMITS: {
    enabled: false,
    selectedDeviceId: null,
    onSleepEnable: {
      enabled: false,
      resetToDefault: false,
    },
    onSleepDisable: {
      enabled: false,
      resetToDefault: true,
    },
  },
  MSI_AFTERBURNER: {
    enabled: false,
    msiAfterburnerPath: 'C:\\Program Files (x86)\\MSI Afterburner\\MSIAfterburner.exe',
    onSleepEnableProfile: 0,
    onSleepDisableProfile: 0,
  },
  BIGSCREEN_BEYOND_FAN_CONTROL: {
    enabled: true,
    onSleepEnable: false,
    onSleepEnableFanSpeed: 50,
    onSleepDisable: false,
    onSleepDisableFanSpeed: 50,
    onSleepPreparation: false,
    onSleepPreparationFanSpeed: 50,
    allowUnsafeFanSpeed: false,
  },
  BIGSCREEN_BEYOND_RGB_CONTROL: {
    enabled: true,
    onSleepEnable: false,
    onSleepEnableRgb: [0, 0, 0],
    onSleepDisable: false,
    onSleepDisableRgb: [0, 255, 0],
    onSleepPreparation: false,
    onSleepPreparationRgb: [128, 0, 0],
  },
};
