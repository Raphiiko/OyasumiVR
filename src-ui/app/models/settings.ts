import { LighthouseDevicePowerState } from './lighthouse-device';
import { PlayerListPreset } from './player-list-preset';
import { OneTimeFlag } from './one-time-flags';
import { EventLogType } from './event-log-entry';

export interface AppSettings {
  version: 10;
  // General Settings
  userLanguage: string;
  userLanguagePicked: boolean;
  askForAdminOnStart: boolean;
  exitInSystemTray: boolean;
  startInSystemTray: boolean;
  sleepModeStartupBehaviour: 'PERSIST' | 'ACTIVE' | 'INACTIVE';
  quitWithSteamVR: QuitWithSteamVRMode;
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
  mqttSecureSocket: boolean;
  // Brightness & CCT
  cctControlEnabled: boolean;
  cctSoftwareMode: boolean;
  // HW Specific
  valveIndexMaxBrightness: number; // User limit
  bigscreenBeyondMaxBrightness: number; // User limit
  bigscreenBeyondUnsafeBrightness: boolean; // Allow brightness above 150%
  bigscreenBeyondBrightnessFanSafety: boolean; // Force fan to 100% if brightness is above 100%
}

export type DiscordActivityMode = 'ENABLED' | 'ONLY_ASLEEP' | 'DISABLED';

export type QuitWithSteamVRMode = 'DISABLED' | 'IMMEDIATELY' | 'AFTERDELAY';

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
  'AUTO_ACCEPTED_INVITE_REQUEST',
] as const;

export type NotificationType = (typeof NotificationTypes)[number];

export const APP_SETTINGS_DEFAULT: AppSettings = {
  version: 10,
  // General Settings
  userLanguage: 'en',
  userLanguagePicked: false,
  askForAdminOnStart: false,
  exitInSystemTray: false,
  startInSystemTray: false,
  sleepModeStartupBehaviour: 'PERSIST',
  quitWithSteamVR: 'DISABLED',
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
  mqttSecureSocket: false,
  // Brightness & CCT
  cctControlEnabled: true,
  cctSoftwareMode: false,
  // HW Specific
  valveIndexMaxBrightness: 160,
  bigscreenBeyondMaxBrightness: 150,
  bigscreenBeyondUnsafeBrightness: false,
  bigscreenBeyondBrightnessFanSafety: true,
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
