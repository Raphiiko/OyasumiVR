import { Injectable } from '@angular/core';
import { firstValueFrom, timer } from 'rxjs';
import { AppSettings } from '../../models/settings';
import { AutomationConfigs } from '../../models/automations';
import { DeviceSelection } from '../../models/device-manager';
import { AppSettingsService } from '../app-settings.service';
import { AutomationConfigService } from '../automation-config.service';
import { VRChatService } from '../vrchat-api/vrchat.service';
import { PulsoidService } from '../integrations/pulsoid.service';
import { TelemetryService } from './telemetry.service';

const ONE_DAY = 1000 * 60 * 60 * 24;

export interface FeatureSnapshotContext {
  settings: AppSettings;
  automations: AutomationConfigs;
  vrchatLoggedIn: boolean;
  pulsoidLoggedIn: boolean;
}

/** Feature usage as 0/1 flags, with keys of at most 40 characters for Aptabase. */
export function buildFeatureSnapshot(ctx: FeatureSnapshotContext): Record<string, number> {
  const { settings: s, automations: a } = ctx;
  const hasDevices = (sel: DeviceSelection) =>
    sel.devices.length > 0 || sel.types.length > 0 || sel.tagIds.length > 0;
  const power = a.DEVICE_POWER_AUTOMATIONS;
  const brightness = a.BRIGHTNESS_AUTOMATIONS;
  const micMute = a.VRCHAT_MIC_MUTE_AUTOMATIONS;
  const avatar = a.VRCHAT_AVATAR_AUTOMATIONS;
  const status = a.CHANGE_STATUS_GENERAL_EVENTS;
  const group = a.VRCHAT_GROUP_AUTOMATIONS;
  const run = a.RUN_AUTOMATIONS;
  const gpu = a.GPU_POWER_LIMITS;
  const fan = a.BIGSCREEN_BEYOND_FAN_CONTROL;
  const rgb = a.BIGSCREEN_BEYOND_RGB_CONTROL;
  const shutdown = a.SHUTDOWN_AUTOMATIONS;
  const audio = a.AUDIO_DEVICE_AUTOMATIONS;
  const sysMic = a.SYSTEM_MIC_MUTE_AUTOMATIONS;
  const join = a.JOIN_NOTIFICATIONS;
  const nightmare = a.NIGHTMARE_DETECTION;
  const osc = a.OSC_GENERAL;
  const msi = a.MSI_AFTERBURNER;

  const flags: Record<string, boolean> = {
    // sleep mode triggers
    sleep_detector: a.SLEEP_MODE_ENABLE_FOR_SLEEP_DETECTOR.enabled,
    sleep_at_time: a.SLEEP_MODE_ENABLE_AT_TIME.enabled,
    sleep_at_battery: a.SLEEP_MODE_ENABLE_AT_BATTERY_PERCENTAGE.enabled,
    sleep_on_controllers_off: a.SLEEP_MODE_ENABLE_ON_CONTROLLERS_POWERED_OFF.enabled,
    sleep_on_heart_rate_calm: a.SLEEP_MODE_ENABLE_ON_HEART_RATE_CALM_PERIOD.enabled,
    wake_at_time: a.SLEEP_MODE_DISABLE_AT_TIME.enabled,
    wake_after_time: a.SLEEP_MODE_DISABLE_AFTER_TIME.enabled,
    wake_on_device_power_on: a.SLEEP_MODE_DISABLE_ON_DEVICE_POWER_ON.enabled,
    wake_on_upright_pose: a.SLEEP_MODE_DISABLE_ON_UPRIGHT_POSE.enabled,
    wake_on_player_join_leave: a.SLEEP_MODE_DISABLE_ON_PLAYER_JOIN_OR_LEAVE.enabled,
    wake_on_steamvr_stop: a.SLEEP_MODE_CHANGE_ON_STEAMVR_STATUS.disableOnSteamVRStop,
    nightmare_detection:
      ctx.pulsoidLoggedIn && (nightmare.disableSleepMode || nightmare.sound.enabled),

    // automations, by their options: most master switches do nothing
    device_power: [
      power.turnOffDevicesOnSleepModeEnable,
      power.turnOffDevicesOnSleepModeDisable,
      power.turnOffDevicesOnSleepPreparation,
      power.turnOffDevicesWhenCharging,
      power.turnOffDevicesBelowBatteryLevel,
      power.turnOffDevicesOnSteamVRStop,
      power.turnOnDevicesOnSteamVRStart,
      power.turnOnDevicesOnOyasumiStart,
      power.turnOnDevicesOnSleepModeDisable,
    ].some(hasDevices),
    brightness: [
      brightness.AT_SUNSET,
      brightness.AT_SUNRISE,
      brightness.SLEEP_PREPARATION,
      brightness.SLEEP_MODE_ENABLE,
      brightness.SLEEP_MODE_DISABLE,
      brightness.HMD_CONNECT,
    ].some((e) => e.enabled),
    render_resolution:
      a.RENDER_RESOLUTION_ON_SLEEP_MODE_ENABLE.enabled ||
      a.RENDER_RESOLUTION_ON_SLEEP_MODE_DISABLE.enabled,
    chaperone_fade:
      a.CHAPERONE_FADE_DISTANCE_ON_SLEEP_MODE_ENABLE.enabled ||
      a.CHAPERONE_FADE_DISTANCE_ON_SLEEP_MODE_DISABLE.enabled,
    audio_devices: [
      audio.onSleepEnableAutomations,
      audio.onSleepDisableAutomations,
      audio.onSleepPreparationAutomations,
    ].some((list) => list.length > 0),
    system_mic_mute:
      sysMic.controllerBinding ||
      sysMic.overlayMuteIndicator ||
      sysMic.vrchatWorldJoinBehaviour !== 'KEEP' ||
      [
        sysMic.onSleepModeEnableState,
        sysMic.onSleepModeDisableState,
        sysMic.onSleepPreparationState,
      ].some((v) => v !== 'NONE'),
    join_notifications: [
      join.joinNotification,
      join.leaveNotification,
      join.joinSoundMode,
      join.leaveSoundMode,
    ].some((mode) => mode !== 'DISABLED' && (mode !== 'WHITELIST' || join.playerIds.length > 0)),
    osc_scripts: [osc.onSleepModeEnable, osc.onSleepModeDisable, osc.onSleepPreparation].some(
      (script) => !!script?.commands.length
    ),
    sleeping_animations: a.SLEEPING_ANIMATIONS.enabled,
    vrchat_mic_mute: [
      micMute.onSleepModeEnable,
      micMute.onSleepModeDisable,
      micMute.onSleepPreparation,
    ].some((v) => v !== 'NONE'),
    vrchat_avatar: [avatar.onSleepEnable, avatar.onSleepDisable, avatar.onSleepPreparation].some(
      (v) => v !== null
    ),
    vrchat_status_by_player_count: a.CHANGE_STATUS_BASED_ON_PLAYER_COUNT.enabled,
    vrchat_status_on_events:
      status.enabled &&
      [
        status.changeStatusOnSleepModeEnable,
        status.changeStatusMessageOnSleepModeEnable,
        status.changeStatusOnSleepModeDisable,
        status.changeStatusMessageOnSleepModeDisable,
        status.changeStatusOnSleepPreparation,
        status.changeStatusMessageOnSleepPreparation,
      ].some(Boolean),
    vrchat_auto_accept_invites: a.AUTO_ACCEPT_INVITE_REQUESTS.enabled,
    vrchat_group: [
      group.representGroupIdOnSleepModeEnable,
      group.representGroupIdOnSleepModeDisable,
      group.representGroupIdOnSleepPreparation,
    ].some((v) => v !== 'DONT_CHANGE'),
    windows_power_policy:
      a.WINDOWS_POWER_POLICY_ON_SLEEP_MODE_ENABLE.enabled ||
      a.WINDOWS_POWER_POLICY_ON_SLEEP_MODE_DISABLE.enabled,
    frame_limit: a.FRAME_LIMIT_AUTOMATIONS.configs.some((c) =>
      [c.onSleepEnable, c.onSleepDisable, c.onSleepPreparation].some((v) => v !== 'DISABLED')
    ),
    shutdown_triggers:
      shutdown.triggersEnabled && (shutdown.triggerOnSleep || shutdown.triggerWhenAlone),
    run_commands: run.onSleepModeEnable || run.onSleepModeDisable || run.onSleepPreparation,
    gpu_power_limits: gpu.enabled && (gpu.onSleepEnable.enabled || gpu.onSleepDisable.enabled),
    msi_afterburner: msi.enabled && (msi.onSleepEnableProfile > 0 || msi.onSleepDisableProfile > 0),
    beyond_fan: fan.onSleepEnable || fan.onSleepDisable || fan.onSleepPreparation,
    beyond_rgb: rgb.onSleepEnable || rgb.onSleepDisable || rgb.onSleepPreparation,

    // integrations and app settings
    vrchat_logged_in: ctx.vrchatLoggedIn,
    pulsoid_logged_in: ctx.pulsoidLoggedIn,
    mqtt: s.mqttEnabled,
    notifications_xsoverlay: s.notificationProvider === 'XSOVERLAY',
    notifications_ovrtoolkit: s.notificationProvider === 'OVRTOOLKIT',
    notifications_desktop: s.notificationProvider === 'DESKTOP',
    vrcx_logs: s.vrcxLogsEnabled.length > 0,
    discord_presence: s.discordActivityMode !== 'DISABLED',
    osc_server: s.oscServerEnabled,
    lighthouse_power_control: s.lighthousePowerControl,
    overlay_menu: s.overlayMenuEnabled,
    elevated_features: s.elevatedFeaturesEnabled,
    start_with_steamvr: s.startWithSteamVR,
    quit_with_steamvr: s.quitWithSteamVR,
    start_in_tray: s.startInSystemTray,
    hotkeys: Object.values(s.hotkeys).some((keys) => keys.length > 0),
  };
  return Object.fromEntries(Object.entries(flags).map(([key, on]) => [key, on ? 1 : 0]));
}

@Injectable({
  providedIn: 'root',
})
export class FeatureSnapshotService {
  constructor(
    private appSettings: AppSettingsService,
    private automationConfig: AutomationConfigService,
    private vrchat: VRChatService,
    private pulsoid: PulsoidService,
    private telemetry: TelemetryService
  ) {}

  // the reporting cache limits the event to once per day, across restarts
  init() {
    // ponytail: a fixed delay instead of an init-complete signal; app init finishes well within it
    timer(1000 * 60 * 5, 1000 * 60 * 60).subscribe(() => this.track());
  }

  private async track() {
    const [settings, automations, vrchatStatus, pulsoidUser] = await Promise.all([
      firstValueFrom(this.appSettings.settings),
      firstValueFrom(this.automationConfig.configs),
      firstValueFrom(this.vrchat.status),
      firstValueFrom(this.pulsoid.loggedInUser),
    ]);
    if (vrchatStatus === 'PRE_INIT') return;
    const snapshot = buildFeatureSnapshot({
      settings,
      automations,
      vrchatLoggedIn: vrchatStatus === 'LOGGED_IN',
      pulsoidLoggedIn: pulsoidUser !== null,
    });
    await this.telemetry.trackThrottledEvent('feature_snapshot', snapshot, ONE_DAY);
  }
}
