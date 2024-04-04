import { OVRDeviceClass } from './ovr-device';
import { OscScript } from './osc-script';
import { SleepingPose } from './sleeping-pose';
import { UserStatus } from 'vrchat/dist';
import { AudioDeviceParsedName, AudioDeviceType } from './audio-device';

export type AutomationType =
  // GPU AUTOMATIONS (Global enable flag)
  | 'GPU_POWER_LIMITS'
  | 'MSI_AFTERBURNER'
  // SLEEP MODE AUTOMATIONS
  | 'SLEEP_MODE_ENABLE_FOR_SLEEP_DETECTOR'
  | 'SLEEP_MODE_ENABLE_AT_TIME'
  | 'SLEEP_MODE_ENABLE_AT_BATTERY_PERCENTAGE'
  | 'SLEEP_MODE_ENABLE_ON_CONTROLLERS_POWERED_OFF'
  | 'SLEEP_MODE_ENABLE_ON_HEART_RATE_CALM_PERIOD'
  | 'SLEEP_MODE_CHANGE_ON_STEAMVR_STATUS'
  | 'SLEEP_MODE_DISABLE_AT_TIME'
  | 'SLEEP_MODE_DISABLE_AFTER_TIME'
  | 'SLEEP_MODE_DISABLE_ON_DEVICE_POWER_ON'
  // POWER AUTOMATIONS
  | 'TURN_OFF_DEVICES_ON_SLEEP_MODE_ENABLE'
  | 'TURN_OFF_DEVICES_WHEN_CHARGING'
  | 'TURN_OFF_DEVICES_ON_BATTERY_LEVEL'
  | 'TURN_ON_LIGHTHOUSES_ON_OYASUMI_START'
  | 'TURN_ON_LIGHTHOUSES_ON_STEAMVR_START'
  | 'TURN_OFF_LIGHTHOUSES_ON_STEAMVR_STOP'
  // OSC AUTOMATIONS
  | 'OSC_GENERAL'
  | 'SLEEPING_ANIMATIONS'
  | 'VRCHAT_MIC_MUTE_AUTOMATIONS'
  // BRIGHTNESS AUTOMATIONS
  | 'BRIGHTNESS_CONTROL_ADVANCED_MODE'
  | 'SET_BRIGHTNESS_ON_SLEEP_MODE_ENABLE'
  | 'SET_BRIGHTNESS_ON_SLEEP_MODE_DISABLE'
  | 'SET_BRIGHTNESS_ON_SLEEP_PREPARATION'
  // RESOLUTION AUTOMATIONS
  | 'RENDER_RESOLUTION_ON_SLEEP_MODE_ENABLE'
  | 'RENDER_RESOLUTION_ON_SLEEP_MODE_DISABLE'
  // CHAPERONE AUTOMATIONS
  | 'CHAPERONE_FADE_DISTANCE_ON_SLEEP_MODE_ENABLE'
  | 'CHAPERONE_FADE_DISTANCE_ON_SLEEP_MODE_DISABLE'
  // WINDOWS POWER POLICY AUTOMATIONS
  | 'WINDOWS_POWER_POLICY_ON_SLEEP_MODE_ENABLE'
  | 'WINDOWS_POWER_POLICY_ON_SLEEP_MODE_DISABLE'
  // MISCELLANEOUS
  | 'AUDIO_DEVICE_AUTOMATIONS'
  | 'SHUTDOWN_AUTOMATIONS'
  | 'AUTO_ACCEPT_INVITE_REQUESTS'
  | 'CHANGE_STATUS_BASED_ON_PLAYER_COUNT'
  | 'SYSTEM_MIC_MUTE_AUTOMATIONS'
  | 'NIGHTMARE_DETECTION'
  | 'BIGSCREEN_BEYOND_FAN_CONTROL'
  | 'BIGSCREEN_BEYOND_RGB_CONTROL';

export interface AutomationConfigs {
  version: 14;
  GPU_POWER_LIMITS: GPUPowerLimitsAutomationConfig;
  MSI_AFTERBURNER: MSIAfterburnerAutomationConfig;
  // SLEEP MODE AUTOMATIONS
  SLEEP_MODE_ENABLE_FOR_SLEEP_DETECTOR: SleepModeEnableForSleepDetectorAutomationConfig;
  SLEEP_MODE_ENABLE_AT_TIME: SleepModeEnableAtTimeAutomationConfig;
  SLEEP_MODE_ENABLE_AT_BATTERY_PERCENTAGE: SleepModeEnableAtBatteryPercentageAutomationConfig;
  SLEEP_MODE_ENABLE_ON_CONTROLLERS_POWERED_OFF: SleepModeEnableAtControllersPoweredOffAutomationConfig;
  SLEEP_MODE_ENABLE_ON_HEART_RATE_CALM_PERIOD: SleepModeEnableOnHeartRateCalmPeriodAutomationConfig;
  SLEEP_MODE_CHANGE_ON_STEAMVR_STATUS: SleepModeChangeOnSteamVRStatusAutomationConfig;
  SLEEP_MODE_DISABLE_AT_TIME: SleepModeDisableAtTimeAutomationConfig;
  SLEEP_MODE_DISABLE_AFTER_TIME: SleepModeDisableAfterTimeAutomationConfig;
  SLEEP_MODE_DISABLE_ON_DEVICE_POWER_ON: SleepModeDisableOnDevicePowerOnAutomationConfig;
  // POWER AUTOMATIONS
  TURN_OFF_DEVICES_ON_SLEEP_MODE_ENABLE: TurnOffDevicesOnSleepModeEnableAutomationConfig;
  TURN_OFF_DEVICES_WHEN_CHARGING: TurnOffDevicesWhenChargingAutomationConfig;
  TURN_OFF_DEVICES_ON_BATTERY_LEVEL: TurnOffDevicesOnBatteryLevelAutomationConfig;
  TURN_ON_LIGHTHOUSES_ON_OYASUMI_START: TurnOnLighthousesOnOyasumiStartAutomationConfig;
  TURN_ON_LIGHTHOUSES_ON_STEAMVR_START: TurnOnLighthousesOnSteamVRStartAutomationConfig;
  TURN_OFF_LIGHTHOUSES_ON_STEAMVR_STOP: TurnOffLighthousesOnSteamVRStopAutomationConfig;
  // OSC AUTOMATIONS
  OSC_GENERAL: OscGeneralAutomationConfig;
  SLEEPING_ANIMATIONS: SleepingAnimationsAutomationConfig;
  VRCHAT_MIC_MUTE_AUTOMATIONS: VRChatMicMuteAutomationsConfig;
  // BRIGHTNESS AUTOMATIONS
  BRIGHTNESS_CONTROL_ADVANCED_MODE: BrightnessControlAdvancedModeAutomationConfig;
  SET_BRIGHTNESS_ON_SLEEP_MODE_ENABLE: SetBrightnessAutomationConfig;
  SET_BRIGHTNESS_ON_SLEEP_MODE_DISABLE: SetBrightnessAutomationConfig;
  SET_BRIGHTNESS_ON_SLEEP_PREPARATION: Omit<SetBrightnessAutomationConfig, 'applyOnStart'>;
  // RESOLUTION AUTOMATIONS
  RENDER_RESOLUTION_ON_SLEEP_MODE_ENABLE: RenderResolutionOnSleepModeAutomationConfig;
  RENDER_RESOLUTION_ON_SLEEP_MODE_DISABLE: RenderResolutionOnSleepModeAutomationConfig;
  // CHAPERONE AUTOMATIONS
  CHAPERONE_FADE_DISTANCE_ON_SLEEP_MODE_ENABLE: ChaperoneFadeDistanceOnSleepModeAutomationConfig;
  CHAPERONE_FADE_DISTANCE_ON_SLEEP_MODE_DISABLE: ChaperoneFadeDistanceOnSleepModeAutomationConfig;
  // WINDOWS POWER POLICY AUTOMATIONS
  WINDOWS_POWER_POLICY_ON_SLEEP_MODE_ENABLE: WindowsPowerPolicyOnSleepModeAutomationConfig;
  WINDOWS_POWER_POLICY_ON_SLEEP_MODE_DISABLE: WindowsPowerPolicyOnSleepModeAutomationConfig;
  // MISCELLANEOUS AUTOMATIONS
  AUDIO_DEVICE_AUTOMATIONS: AudioDeviceAutomationsConfig;
  SYSTEM_MIC_MUTE_AUTOMATIONS: SystemMicMuteAutomationsConfig;
  SHUTDOWN_AUTOMATIONS: ShutdownAutomationsConfig;
  CHANGE_STATUS_BASED_ON_PLAYER_COUNT: ChangeStatusBasedOnPlayerCountAutomationConfig;
  AUTO_ACCEPT_INVITE_REQUESTS: AutoAcceptInviteRequestsAutomationConfig;
  NIGHTMARE_DETECTION: NightmareDetectionAutomationsConfig;
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
export interface BrightnessControlAdvancedModeAutomationConfig extends AutomationConfig {}

export interface SetBrightnessAutomationConfig extends AutomationConfig {
  brightness: number;
  softwareBrightness: number;
  hardwareBrightness: number;
  transition: boolean;
  transitionTime: number;
  applyOnStart: boolean;
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

// DEVICE POWER AUTOMATIONS
export interface TurnOffDevicesOnSleepModeEnableAutomationConfig extends AutomationConfig {
  deviceClasses: OVRDeviceClass[];
}

export interface TurnOffDevicesWhenChargingAutomationConfig extends AutomationConfig {
  deviceClasses: OVRDeviceClass[];
}

export interface TurnOffDevicesOnBatteryLevelAutomationConfig extends AutomationConfig {
  turnOffControllers: boolean;
  turnOffControllersAtLevel: number;
  turnOffControllersOnlyDuringSleepMode: boolean;
  turnOffTrackers: boolean;
  turnOffTrackersAtLevel: number;
  turnOffTrackersOnlyDuringSleepMode: boolean;
}

export interface TurnOnLighthousesOnOyasumiStartAutomationConfig extends AutomationConfig {}

export interface TurnOnLighthousesOnSteamVRStartAutomationConfig extends AutomationConfig {}

export interface TurnOffLighthousesOnSteamVRStopAutomationConfig extends AutomationConfig {}

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
  statusAtLimitOrAbove: UserStatus;
  onlyIfSleepModeEnabled: boolean;
}

// WINDOWS POWER POLICY AUTOMATIONS
export interface WindowsPowerPolicyOnSleepModeAutomationConfig extends AutomationConfig {
  powerPolicy?: string;
}

// MISCELLANEOUS AUTOMATIONS

export type AudioVolumeAutomationType = 'SET_VOLUME' | 'MUTE' | 'UNMUTE';
export type AudioVolumeAutomation =
  | MuteAudioVolumeAutomation
  | UnmuteAudioVolumeAutomation
  | SetAudioVolumeAutomation;

export interface BaseAudioVolumeAutomation {
  type: AudioVolumeAutomationType;
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
  listMode: 'DISABLED' | 'WHITELIST' | 'BLACKLIST';
  playerIds: string[];
}

export type PowerDownWindowsMode = 'SHUTDOWN' | 'REBOOT' | 'SLEEP' | 'HIBERNATE' | 'LOGOUT';

export interface ShutdownAutomationsConfig extends AutomationConfig {
  triggerOnSleep: boolean;
  sleepDuration: number;
  activationWindow: boolean;
  activationWindowStart: [number, number];
  activationWindowEnd: [number, number];
  quitSteamVR: boolean;
  turnOffControllers: boolean;
  turnOffTrackers: boolean;
  turnOffBaseStations: boolean;
  powerDownWindows: boolean;
  powerDownWindowsMode: PowerDownWindowsMode;
}

export interface NightmareDetectionAutomationsConfig extends AutomationConfig {
  heartRateThreshold: number;
  periodDuration: number;
  disableSleepMode: boolean;
  playSound: boolean;
  soundVolume: number;
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

//
// DEFAULT
//

export const AUTOMATION_CONFIGS_DEFAULT: AutomationConfigs = {
  version: 14,
  // BRIGHTNESS AUTOMATIONS
  BRIGHTNESS_CONTROL_ADVANCED_MODE: {
    enabled: false,
  },
  SET_BRIGHTNESS_ON_SLEEP_MODE_ENABLE: {
    enabled: false,
    brightness: 20,
    softwareBrightness: 20,
    hardwareBrightness: 100,
    transition: true,
    transitionTime: 1000 * 60 * 5,
    applyOnStart: false,
  },
  SET_BRIGHTNESS_ON_SLEEP_MODE_DISABLE: {
    enabled: false,
    brightness: 100,
    softwareBrightness: 100,
    hardwareBrightness: 100,
    transition: true,
    transitionTime: 10000,
    applyOnStart: false,
  },
  SET_BRIGHTNESS_ON_SLEEP_PREPARATION: {
    enabled: false,
    brightness: 50,
    softwareBrightness: 50,
    hardwareBrightness: 100,
    transition: true,
    transitionTime: 30000,
  },
  // RESOLUTION AUTOMATIONS
  RENDER_RESOLUTION_ON_SLEEP_MODE_ENABLE: {
    enabled: false,
    resolution: 50,
  },
  RENDER_RESOLUTION_ON_SLEEP_MODE_DISABLE: {
    enabled: false,
    resolution: null,
  },
  // CHAPERONE AUTOMATIONS
  CHAPERONE_FADE_DISTANCE_ON_SLEEP_MODE_ENABLE: {
    enabled: false,
    fadeDistance: 0.0,
  },
  CHAPERONE_FADE_DISTANCE_ON_SLEEP_MODE_DISABLE: {
    enabled: false,
    fadeDistance: 0.7,
  },
  // GPU AUTOMATIONS
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
  // SLEEP MODE AUTOMATIONS
  SLEEP_MODE_ENABLE_FOR_SLEEP_DETECTOR: {
    enabled: false,
    calibrationValue: 0.01,
    sensitivity: 'MEDIUM',
    sleepCheck: false,
    detectionWindowMinutes: 15,
    activationWindow: false,
    activationWindowStart: [23, 0],
    activationWindowEnd: [7, 0],
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
  // DEVICE POWER AUTOMATIONS
  TURN_OFF_DEVICES_ON_SLEEP_MODE_ENABLE: {
    enabled: true,
    deviceClasses: [],
  },
  TURN_OFF_DEVICES_WHEN_CHARGING: {
    enabled: true,
    deviceClasses: [],
  },
  TURN_OFF_DEVICES_ON_BATTERY_LEVEL: {
    enabled: true,
    turnOffControllers: false,
    turnOffControllersAtLevel: 50,
    turnOffControllersOnlyDuringSleepMode: false,
    turnOffTrackers: false,
    turnOffTrackersAtLevel: 50,
    turnOffTrackersOnlyDuringSleepMode: false,
  },
  TURN_ON_LIGHTHOUSES_ON_OYASUMI_START: {
    enabled: false,
  },
  TURN_ON_LIGHTHOUSES_ON_STEAMVR_START: {
    enabled: false,
  },
  TURN_OFF_LIGHTHOUSES_ON_STEAMVR_STOP: {
    enabled: false,
  },
  // OSC AUTOMATIONS
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
    oscScripts: {},
  },
  VRCHAT_MIC_MUTE_AUTOMATIONS: {
    enabled: true,
    onSleepModeEnable: 'NONE',
    onSleepModeDisable: 'NONE',
    onSleepPreparation: 'NONE',
  },
  // STATUS AUTOMATIONS
  CHANGE_STATUS_BASED_ON_PLAYER_COUNT: {
    enabled: false,
    limit: 2,
    statusBelowLimit: UserStatus.JoinMe,
    statusAtLimitOrAbove: UserStatus.Busy,
    onlyIfSleepModeEnabled: false,
  },
  // INVITE AUTOMATIONS
  AUTO_ACCEPT_INVITE_REQUESTS: {
    enabled: false,
    onlyIfSleepModeEnabled: false,
    listMode: 'WHITELIST',
    playerIds: [],
  },
  // SHUTDOWN AUTOMATIONS
  SHUTDOWN_AUTOMATIONS: {
    enabled: true,
    triggerOnSleep: false,
    sleepDuration: 15 * 60 * 1000,
    activationWindow: false,
    activationWindowStart: [23, 0],
    activationWindowEnd: [7, 0],
    quitSteamVR: true,
    turnOffControllers: true,
    turnOffTrackers: true,
    turnOffBaseStations: true,
    powerDownWindows: true,
    powerDownWindowsMode: 'SHUTDOWN',
  },
  // WINDOWS POWER POLICY AUTOMATIONS
  WINDOWS_POWER_POLICY_ON_SLEEP_MODE_ENABLE: {
    enabled: false,
  },
  WINDOWS_POWER_POLICY_ON_SLEEP_MODE_DISABLE: {
    enabled: false,
  },
  // MISCELLANEOUS AUTOMATIONS
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
  NIGHTMARE_DETECTION: {
    enabled: false,
    heartRateThreshold: 130,
    periodDuration: 60 * 1000,
    disableSleepMode: false,
    playSound: false,
    soundVolume: 100,
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
