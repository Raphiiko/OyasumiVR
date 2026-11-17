import { LighthouseDevicePowerState } from './lighthouse-device';
import { PlayerListPreset } from './player-list-preset';
import { OneTimeFlag } from './one-time-flags';
import { EventLogType } from './event-log-entry';

/**
 * A headset's own brightness and colour temperature values, for the model the app detects it as.
 * A missing value uses the model's default.
 */
export type HmdSettings =
  ValveIndexHmdSettings | BigscreenBeyondHmdSettings | SteamFrameHmdSettings | OtherHmdSettings;

interface HmdSettingsBase<M extends string> {
  model: M;
}

/** A model whose hardware brightness has a dedicated driver. */
interface HardwareBrightnessHmdSettings<M extends string> extends HmdSettingsBase<M> {
  maxBrightness?: number;
}

export type ValveIndexHmdSettings = HardwareBrightnessHmdSettings<'VALVE_INDEX'>;

export interface BigscreenBeyondHmdSettings extends HardwareBrightnessHmdSettings<'BIGSCREEN_BEYOND'> {
  /** Allows a maxBrightness above 150%. */
  unsafeBrightness?: boolean;
}

export type SteamFrameHmdSettings = HardwareBrightnessHmdSettings<'STEAM_FRAME'>;

/** A headset without a dedicated brightness driver, and not on the SteamVR colour gain list. */
export interface OtherHmdSettings extends HmdSettingsBase<'OTHER'> {
  hardwareBrightnessOnUnsupportedHmd?: boolean;
  cctControlOnUnsupportedHmd?: boolean;
}

export type HmdSettingsModel = HmdSettings['model'];

/** A headset's own values, or undefined while it has none stored for this model. */
export function ownHmdSettings<M extends HmdSettingsModel>(
  settings: AppSettings,
  id: string | null | undefined,
  model: M
): Extract<HmdSettings, { model: M }> | undefined {
  const own = id ? settings.hmdSettings[id] : undefined;
  return own?.model === model ? (own as Extract<HmdSettings, { model: M }>) : undefined;
}

export interface AppSettings {
  version: 19;
  // General Settings
  userLanguage: string;
  userLanguagePicked: boolean;
  elevatedFeaturesEnabled: boolean;
  exitInSystemTray: boolean;
  startInSystemTray: boolean;
  sleepModeStartupBehaviour: 'PERSIST' | 'ACTIVE' | 'INACTIVE';
  quitWithSteamVR: boolean;
  startWithSteamVR: boolean;
  startWithSteamVRPending: boolean;
  hotkeys: { [hotkeyId: string]: string[] };
  playerListPresets: PlayerListPreset[];
  hideSnowverlay: boolean;
  openVrInitDelayFix: boolean;
  oneTimeFlags: OneTimeFlag[];
  eventLogTypesHidden: EventLogType[];
  // Notifications
  notificationProvider: NotificationProvider;
  notificationsEnabled: { types: NotificationType[] };
  generalNotificationVolume: number;
  // OSC
  oscServerEnabled: boolean;
  oscTargets: OSCTarget[];
  oscCustomTargetHost: string;
  oscCustomTargetPort: number;
  // Message center
  hiddenMessageIds: string[];
  // Overlay
  overlayMenuEnabled: boolean;
  overlayGpuAcceleration: boolean;
  overlayMenuOnlyOpenWhenVRChatIsRunning: boolean;
  // Lighthouse
  lighthouseConsolePath: string;
  lighthousePowerControl: boolean;
  lighthousePowerOffState: LighthouseDevicePowerState;
  lighthousePowerOffDelay: boolean;
  v1LighthouseIdentifiers: {
    [deviceId: string]: string;
  };
  // Discord Rich Presence
  discordActivityMode: DiscordActivityMode;
  discordActivityOnlyWhileVRChatIsRunning: boolean;
  // MQTT
  mqttEnabled: boolean;
  mqttHost: string | null;
  mqttPort: number | null;
  mqttUsername: string | null;
  mqttPassword: string | null;
  mqttProtectedPassword: string | null;
  mqttSecureSocket: boolean;
  // Brightness & CCT
  cctSoftwareMode: boolean;
  // HW Specific
  bigscreenBeyondBrightnessFanSafety: boolean; // Force fan to 100% if brightness is above 100%
  /** Each headset's own values, by known device id. */
  hmdSettings: Record<string, HmdSettings>;
  // VRCX
  vrcxLogsEnabled: VRCXEventLogType[];
}

export type VRCXEventLogType = 'SleepMode' | 'Invites' | 'StatusChanges' | 'GroupChanges';

export type DiscordActivityMode = 'ENABLED' | 'ONLY_ASLEEP' | 'DISABLED';

export type OSCTarget = 'VRCHAT_OSCQUERY' | 'CUSTOM';

export type HotkeyId =
  | 'HOTKEY_TOGGLE_SLEEP_MODE'
  | 'HOTKEY_ENABLE_SLEEP_MODE'
  | 'HOTKEY_DISABLE_SLEEP_MODE'
  | 'HOTKEY_RUN_SLEEP_PREPARATION'
  | 'HOTKEY_RUN_SHUTDOWN_SEQUENCE'
  | 'HOTKEY_TURN_OFF_CONTROLLER_DEVICES'
  | 'HOTKEY_TURN_OFF_TRACKER_DEVICES'
  | 'HOTKEY_TOGGLE_LIGHTHOUSE_DEVICES'
  | 'HOTKEY_TURN_ON_LIGHTHOUSE_DEVICES'
  | 'HOTKEY_TURN_OFF_LIGHTHOUSE_DEVICES';

export const NotificationTypes = [
  'SLEEP_MODE_ENABLED',
  'SLEEP_MODE_DISABLED',
  'AUTO_UPDATED_VRC_STATUS',
  'INVITE_AUTOMATIONS',
] as const;

export type NotificationType = (typeof NotificationTypes)[number];

export const APP_SETTINGS_DEFAULT: AppSettings = {
  version: 19,
  // General Settings
  userLanguage: 'en',
  userLanguagePicked: false,
  elevatedFeaturesEnabled: false,
  exitInSystemTray: false,
  startInSystemTray: false,
  sleepModeStartupBehaviour: 'PERSIST',
  quitWithSteamVR: false,
  startWithSteamVR: false,
  startWithSteamVRPending: false,
  hotkeys: {},
  playerListPresets: [],
  hideSnowverlay: false,
  openVrInitDelayFix: false,
  oneTimeFlags: [],
  eventLogTypesHidden: [],
  // Notifications
  notificationProvider: 'OYASUMIVR',
  notificationsEnabled: { types: [...NotificationTypes] as NotificationType[] },
  generalNotificationVolume: 100,
  // OSC
  oscServerEnabled: true,
  oscTargets: ['VRCHAT_OSCQUERY'],
  oscCustomTargetHost: '127.0.0.1',
  oscCustomTargetPort: 9000,
  // Message center
  hiddenMessageIds: [],
  // Overlay
  overlayMenuEnabled: true,
  overlayGpuAcceleration: true,
  overlayMenuOnlyOpenWhenVRChatIsRunning: false,
  // Lighthouse
  lighthouseConsolePath:
    'C:\\Program Files (x86)\\Steam\\steamapps\\common\\SteamVR\\tools\\lighthouse\\bin\\win64\\lighthouse_console.exe',
  lighthousePowerControl: true,
  lighthousePowerOffState: 'sleep',
  lighthousePowerOffDelay: false,
  v1LighthouseIdentifiers: {},
  // Discord Rich Presence
  discordActivityMode: 'ENABLED',
  discordActivityOnlyWhileVRChatIsRunning: true,
  // MQTT
  mqttEnabled: false,
  mqttHost: null,
  mqttPort: null,
  mqttUsername: null,
  mqttPassword: null,
  mqttProtectedPassword: null,
  mqttSecureSocket: false,
  // Brightness & CCT
  cctSoftwareMode: false,
  // HW Specific
  bigscreenBeyondBrightnessFanSafety: true,
  hmdSettings: {},
  // VRCX
  vrcxLogsEnabled: ['SleepMode', 'Invites', 'StatusChanges', 'GroupChanges'],
};

export type ExecutableReferenceStatus =
  | 'UNKNOWN'
  | 'CHECKING'
  | 'NOT_FOUND'
  | 'INVALID_EXECUTABLE'
  | 'PERMISSION_DENIED'
  | 'INVALID_FILENAME'
  | 'INVALID_SIGNATURE'
  | 'UNKNOWN_ERROR'
  | 'SUCCESS';

export type NotificationProvider = 'OYASUMIVR' | 'XSOVERLAY' | 'DESKTOP' | 'OVRTOOLKIT';
