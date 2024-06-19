import { Injectable } from '@angular/core';
import { SleepService } from '../sleep.service';
import { VRChatService } from '../vrchat.service';
import {
  asyncScheduler,
  BehaviorSubject,
  combineLatest,
  distinctUntilChanged,
  filter,
  map,
  pairwise,
  startWith,
  throttleTime,
} from 'rxjs';
import { isEqual } from 'lodash';
import { UserStatus } from 'vrchat';
import { IPCService } from '../ipc.service';
import { AutomationConfigService } from '../automation-config.service';
import {
  MicrophoneActivityMode,
  OyasumiSidecarAutomationsState_AutoAcceptInviteRequests_Mode,
  OyasumiSidecarDeviceInfo,
  OyasumiSidecarDeviceInfo_Controller,
  OyasumiSidecarDeviceInfo_Tracker,
  OyasumiSidecarState,
  VrcStatus,
} from '../../../../src-grpc-web-client/overlay-sidecar_pb';
import { AUTOMATION_CONFIGS_DEFAULT, AutomationConfigs } from '../../models/automations';
import { SLEEPING_ANIMATION_PRESETS } from '../../models/sleeping-animation-presets';
import { AppSettingsService } from '../app-settings.service';
import {
  ShutdownAutomationsService,
  ShutdownSequenceStageOrder,
} from '../shutdown-automations.service';
import { OpenVRService } from '../openvr.service';
import { OVRDevice } from '../../models/ovr-device';
import { APP_SETTINGS_DEFAULT } from '../../models/settings';
import { SimpleBrightnessControlService } from '../brightness-control/simple-brightness-control.service';
import { HardwareBrightnessControlService } from '../brightness-control/hardware-brightness-control.service';
import { SoftwareBrightnessControlService } from '../brightness-control/software-brightness-control.service';
import { SleepPreparationService } from '../sleep-preparation.service';
import { SystemMicMuteAutomationService } from '../system-mic-mute-automation.service';

@Injectable({
  providedIn: 'root',
})
export class OverlayStateSyncService {
  private state = new BehaviorSubject<OyasumiSidecarState>({
    sleepMode: false,
    vrcStatus: VrcStatus.Offline,
    vrcUsername: '',
    automations: {
      autoAcceptInviteRequests: {
        enabled: AUTOMATION_CONFIGS_DEFAULT.AUTO_ACCEPT_INVITE_REQUESTS.enabled,
        mode: this.mapAutoAcceptInviteRequestsListMode(
          AUTOMATION_CONFIGS_DEFAULT.AUTO_ACCEPT_INVITE_REQUESTS.listMode
        ),
        playerCount: AUTOMATION_CONFIGS_DEFAULT.AUTO_ACCEPT_INVITE_REQUESTS.playerIds.length,
      },
      changeStatusBasedOnPlayerCount: {
        enabled: AUTOMATION_CONFIGS_DEFAULT.CHANGE_STATUS_BASED_ON_PLAYER_COUNT.enabled,
        threshold: AUTOMATION_CONFIGS_DEFAULT.CHANGE_STATUS_BASED_ON_PLAYER_COUNT.limit,
      },
      sleepingAnimations: {
        enabled: AUTOMATION_CONFIGS_DEFAULT.SLEEPING_ANIMATIONS.enabled,
        presetName: AUTOMATION_CONFIGS_DEFAULT.SLEEPING_ANIMATIONS.preset ?? '',
      },
      shutdownAutomations: {
        triggersEnabled: AUTOMATION_CONFIGS_DEFAULT.SHUTDOWN_AUTOMATIONS.triggersEnabled,
        running: false,
        canStart: false,
        triggersConfigured: 0,
      },
      sleepModeEnableForSleepDetector: {
        enabled: AUTOMATION_CONFIGS_DEFAULT.SLEEP_MODE_ENABLE_FOR_SLEEP_DETECTOR.enabled,
        sensitivity: AUTOMATION_CONFIGS_DEFAULT.SLEEP_MODE_ENABLE_FOR_SLEEP_DETECTOR.sensitivity,
        activationWindow:
          AUTOMATION_CONFIGS_DEFAULT.SLEEP_MODE_ENABLE_FOR_SLEEP_DETECTOR.activationWindow,
        activationWindowStart:
          AUTOMATION_CONFIGS_DEFAULT.SLEEP_MODE_ENABLE_FOR_SLEEP_DETECTOR.activationWindowStart,
        activationWindowEnd:
          AUTOMATION_CONFIGS_DEFAULT.SLEEP_MODE_ENABLE_FOR_SLEEP_DETECTOR.activationWindowEnd,
      },
    },
    locale: APP_SETTINGS_DEFAULT.userLanguage,
    deviceInfo: {
      controllers: [],
      trackers: [],
    },
    settings: {
      systemMicIndicatorEnabled:
        AUTOMATION_CONFIGS_DEFAULT.SYSTEM_MIC_MUTE_AUTOMATIONS.overlayMuteIndicator,
      systemMicIndicatorOpacity:
        AUTOMATION_CONFIGS_DEFAULT.SYSTEM_MIC_MUTE_AUTOMATIONS.overlayMuteIndicatorOpacity,
      systemMicIndicatorFadeout:
        AUTOMATION_CONFIGS_DEFAULT.SYSTEM_MIC_MUTE_AUTOMATIONS.overlayMuteIndicatorFade,
      systemMicIndicatorVoiceActivationMode: this.mapMicrophoneActivityMode(
        AUTOMATION_CONFIGS_DEFAULT.SYSTEM_MIC_MUTE_AUTOMATIONS.voiceActivationMode
      ),
    },
    brightnessState: {
      advancedMode: AUTOMATION_CONFIGS_DEFAULT.BRIGHTNESS_CONTROL_ADVANCED_MODE.enabled,
      brightness: 100,
      hardwareBrightness: 100,
      softwareBrightness: 100,
      brightnessTransitioning: false,
      hardwareBrightnessTransitioning: false,
      softwareBrightnessTransitioning: false,
      brightnessTransitionTarget: 100,
      hardwareBrightnessTransitionTarget: 100,
      softwareBrightnessTransitionTarget: 100,
      hardwareBrightnessAvailable: false,
      hardwareMinBrightness: 20,
      hardwareMaxBrightness: 160,
    },
    sleepPreparationAvailable: false,
    sleepPreparationTimedOut: false,
    systemMicMuted: false,
  });

  constructor(
    private sleepService: SleepService,
    private vrchatService: VRChatService,
    private ipcService: IPCService,
    private automationConfig: AutomationConfigService,
    private appSettings: AppSettingsService,
    private shutdownAutomationsService: ShutdownAutomationsService,
    private openvr: OpenVRService,
    private simpleBrightness: SimpleBrightnessControlService,
    private hardwareBrightness: HardwareBrightnessControlService,
    private softwareBrightness: SoftwareBrightnessControlService,
    private sleepPreparation: SleepPreparationService,
    private systemMicMuteAutomationService: SystemMicMuteAutomationService
  ) {}

  async init() {
    this.syncToSidecar_WhenStateChanges();
    this.updateState_WhenSleepModeChanges();
    this.updateState_WhenVRCUserChanges();
    this.updateState_WhenLocaleChanges();
    this.updateState_WhenAutomationConfigsChange();
    this.updateState_WhenShutdownAutomationStateChanges();
    this.updateState_WhenOVRDevicesChange();
    this.updateState_WhenAppSettingsChange();
    this.updateState_WhenBrightnessStateChanges();
    this.updateState_WhenSleepPreparationStateChanges();
    this.updateState_WhenSystemMicMuteStateChanges();
  }

  private syncToSidecar_WhenStateChanges() {
    combineLatest([
      this.state.pipe(distinctUntilChanged((a, b) => isEqual(a, b))),
      this.ipcService.overlaySidecarClient,
    ])
      .pipe(filter(([, client]) => !!client))
      .subscribe(([state, client]) => {
        client!.syncState(state);
      });
  }

  private updateState_WhenSleepModeChanges() {
    this.sleepService.mode.subscribe((sleepMode) => {
      this.state.next({ ...structuredClone(this.state.value), sleepMode });
    });
  }

  private updateState_WhenVRCUserChanges() {
    this.vrchatService.user.subscribe((user) => {
      this.state.next({
        ...structuredClone(this.state.value),
        vrcUsername: user?.displayName ?? '',
        vrcStatus: this.mapVRCStatus(user?.status),
      });
    });
  }

  private updateState_WhenLocaleChanges() {
    this.appSettings.settings
      .pipe(
        map((settings) => settings.userLanguage),
        distinctUntilChanged()
      )
      .subscribe((locale) => {
        this.state.next({
          ...structuredClone(this.state.value),
          locale,
        });
      });
  }

  private updateState_WhenAutomationConfigsChange() {
    this.automationConfig.configs
      .pipe(
        map((configs) => ({ ...configs })),
        startWith({} as AutomationConfigs),
        pairwise(),
        filter(([oldConfigs, newConfigs]) => {
          const configIds: Array<keyof AutomationConfigs> = [
            'AUTO_ACCEPT_INVITE_REQUESTS',
            'CHANGE_STATUS_BASED_ON_PLAYER_COUNT',
            'SLEEPING_ANIMATIONS',
            'SHUTDOWN_AUTOMATIONS',
            'SLEEP_MODE_ENABLE_FOR_SLEEP_DETECTOR',
            'BRIGHTNESS_CONTROL_ADVANCED_MODE',
            'SYSTEM_MIC_MUTE_AUTOMATIONS',
          ];
          return configIds.some((configId) => !isEqual(oldConfigs[configId], newConfigs[configId]));
        }),
        map(([, configs]) => configs)
      )
      .subscribe((configs) => {
        const state = structuredClone(this.state.value);
        {
          const automation = state.automations!.autoAcceptInviteRequests!;
          automation.enabled = configs.AUTO_ACCEPT_INVITE_REQUESTS.enabled;
          automation.mode = this.mapAutoAcceptInviteRequestsListMode(
            configs.AUTO_ACCEPT_INVITE_REQUESTS.listMode
          );
          automation.playerCount = configs.AUTO_ACCEPT_INVITE_REQUESTS.playerIds.length;
        }
        {
          const automation = state.automations!.changeStatusBasedOnPlayerCount!;
          automation.enabled = configs.CHANGE_STATUS_BASED_ON_PLAYER_COUNT.enabled;
          automation.threshold = configs.CHANGE_STATUS_BASED_ON_PLAYER_COUNT.limit;
        }
        {
          const automation = state.automations!.sleepModeEnableForSleepDetector!;
          automation.enabled = configs.SLEEP_MODE_ENABLE_FOR_SLEEP_DETECTOR.enabled;
          automation.sensitivity = configs.SLEEP_MODE_ENABLE_FOR_SLEEP_DETECTOR.sensitivity;
          automation.activationWindow =
            configs.SLEEP_MODE_ENABLE_FOR_SLEEP_DETECTOR.activationWindow;
          automation.activationWindowStart =
            configs.SLEEP_MODE_ENABLE_FOR_SLEEP_DETECTOR.activationWindowStart;
          automation.activationWindowEnd =
            configs.SLEEP_MODE_ENABLE_FOR_SLEEP_DETECTOR.activationWindowEnd;
        }
        {
          const automation = state.automations!.sleepingAnimations!;
          automation.enabled = configs.SLEEPING_ANIMATIONS.enabled;
          if (
            configs.SLEEPING_ANIMATIONS.preset &&
            configs.SLEEPING_ANIMATIONS.preset !== 'CUSTOM'
          ) {
            const preset = SLEEPING_ANIMATION_PRESETS.find(
              (p) => p.id === configs.SLEEPING_ANIMATIONS.preset
            );
            automation.presetName = preset ? preset.name + ' ' + preset.versions : 'Unknown Preset';
          } else {
            automation.presetName = '';
          }
        }
        {
          const automation = state.automations!.shutdownAutomations!;
          automation.triggersEnabled = configs.SHUTDOWN_AUTOMATIONS.triggersEnabled;
          automation.triggersConfigured = [
            configs.SHUTDOWN_AUTOMATIONS.triggerOnSleep,
            configs.SHUTDOWN_AUTOMATIONS.triggerWhenAlone,
          ].filter(Boolean).length;
          automation.canStart =
            this.shutdownAutomationsService.getApplicableStages(configs.SHUTDOWN_AUTOMATIONS)
              .length > 0;
        }
        {
          state.brightnessState!.advancedMode = configs.BRIGHTNESS_CONTROL_ADVANCED_MODE.enabled;
        }
        {
          state.settings!.systemMicIndicatorEnabled =
            configs.SYSTEM_MIC_MUTE_AUTOMATIONS.overlayMuteIndicator;
          state.settings!.systemMicIndicatorOpacity =
            configs.SYSTEM_MIC_MUTE_AUTOMATIONS.overlayMuteIndicatorOpacity;
          state.settings!.systemMicIndicatorFadeout =
            configs.SYSTEM_MIC_MUTE_AUTOMATIONS.overlayMuteIndicatorFade;
          state.settings!.systemMicIndicatorVoiceActivationMode = this.mapMicrophoneActivityMode(
            configs.SYSTEM_MIC_MUTE_AUTOMATIONS.voiceActivationMode
          );
        }
        this.state.next(state);
      });
  }

  private updateState_WhenShutdownAutomationStateChanges() {
    this.shutdownAutomationsService.stage.subscribe((stage) => {
      const index = ShutdownSequenceStageOrder.indexOf(stage);
      const active = index > 0;
      const state = structuredClone(this.state.value);
      if (state.automations?.shutdownAutomations?.running !== active) {
        const automation = state.automations!.shutdownAutomations!;
        automation.running = active;
        this.state.next(state);
      }
    });
  }

  private updateState_WhenOVRDevicesChange() {
    this.openvr.devices
      .pipe(throttleTime(100, asyncScheduler, { leading: true, trailing: true }))
      .subscribe((devices) => {
        const state = structuredClone(this.state.value);
        const deviceInfo: OyasumiSidecarDeviceInfo = {
          controllers: [],
          trackers: [],
        };
        for (const device of devices) {
          switch (device.class) {
            case 'Controller':
              deviceInfo.controllers.push(this.mapOVRDevice(device));
              break;
            case 'GenericTracker':
              deviceInfo.trackers.push(this.mapOVRDevice(device));
              break;
          }
        }
        if (!isEqual(deviceInfo, state.deviceInfo)) {
          state.deviceInfo = deviceInfo;
          this.state.next(state);
        }
      });
  }

  private updateState_WhenAppSettingsChange() {
    // Reserved for future use when adding more overlay preferences
    // this.appSettings.settings.subscribe((settings) => {
    //   const state = structuredClone(this.state.value);
    //   this.state.next(state);
    // });
  }

  private updateState_WhenBrightnessStateChanges() {
    this.simpleBrightness.brightnessStream
      .pipe(
        map((brightness) => Math.round(brightness)),
        distinctUntilChanged()
      )
      .subscribe((brightness) => {
        const state = structuredClone(this.state.value);
        state.brightnessState!.brightness = brightness;
        this.state.next(state);
      });
    this.hardwareBrightness.brightnessStream
      .pipe(
        map((brightness) => Math.round(brightness)),
        distinctUntilChanged()
      )
      .subscribe((brightness) => {
        const state = structuredClone(this.state.value);
        state.brightnessState!.hardwareBrightness = brightness;
        this.state.next(state);
      });
    this.softwareBrightness.brightnessStream
      .pipe(
        map((brightness) => Math.round(brightness)),
        distinctUntilChanged()
      )
      .subscribe((brightness) => {
        const state = structuredClone(this.state.value);
        state.brightnessState!.softwareBrightness = brightness;
        this.state.next(state);
      });
    combineLatest([
      this.hardwareBrightness.brightnessBounds,
      this.hardwareBrightness.driverIsAvailable,
    ]).subscribe(([bounds, available]) => {
      const state = structuredClone(this.state.value);
      state.brightnessState!.hardwareBrightnessAvailable = available;
      state.brightnessState!.hardwareMinBrightness = bounds[0];
      state.brightnessState!.hardwareMaxBrightness = bounds[1];
      this.state.next(state);
    });
    this.simpleBrightness.activeTransition.pipe(distinctUntilChanged()).subscribe((transition) => {
      const state = structuredClone(this.state.value);
      state.brightnessState!.brightnessTransitioning = !!transition;
      if (transition)
        state.brightnessState!.brightnessTransitionTarget = transition.targetBrightness;
      this.state.next(state);
    });
    this.hardwareBrightness.activeTransition
      .pipe(distinctUntilChanged())
      .subscribe((transition) => {
        const state = structuredClone(this.state.value);
        state.brightnessState!.hardwareBrightnessTransitioning = !!transition;
        if (transition)
          state.brightnessState!.hardwareBrightnessTransitionTarget = transition.targetBrightness;
        this.state.next(state);
      });
    this.softwareBrightness.activeTransition
      .pipe(distinctUntilChanged())
      .subscribe((transition) => {
        const state = structuredClone(this.state.value);
        state.brightnessState!.softwareBrightnessTransitioning = !!transition;
        if (transition)
          state.brightnessState!.softwareBrightnessTransitionTarget = transition.targetBrightness;
        this.state.next(state);
      });
  }

  private updateState_WhenSleepPreparationStateChanges() {
    this.sleepPreparation.sleepPreparationAvailable.subscribe((available) => {
      const state = structuredClone(this.state.value);
      state.sleepPreparationAvailable = available;
      this.state.next(state);
    });
    this.sleepPreparation.sleepPreparationTimedOut.subscribe((timedOut) => {
      const state = structuredClone(this.state.value);
      state.sleepPreparationTimedOut = timedOut;
      this.state.next(state);
    });
  }

  private updateState_WhenSystemMicMuteStateChanges() {
    this.systemMicMuteAutomationService.isMicMuted
      .pipe(distinctUntilChanged())
      .subscribe((muted) => {
        const state = structuredClone(this.state.value);
        state.systemMicMuted = muted ?? false;
        this.state.next(state);
      });
  }

  private mapVRCStatus(vrcStatus: UserStatus | undefined): VrcStatus {
    switch (vrcStatus) {
      case UserStatus.JoinMe:
        return VrcStatus.JoinMe;
      case UserStatus.Active:
        return VrcStatus.Active;
      case UserStatus.AskMe:
        return VrcStatus.AskMe;
      case UserStatus.Busy:
        return VrcStatus.Busy;
      default:
        return VrcStatus.Offline;
    }
  }

  private mapAutoAcceptInviteRequestsListMode(
    mode: 'DISABLED' | 'WHITELIST' | 'BLACKLIST'
  ): OyasumiSidecarAutomationsState_AutoAcceptInviteRequests_Mode {
    switch (mode) {
      case 'DISABLED':
        return OyasumiSidecarAutomationsState_AutoAcceptInviteRequests_Mode.Disabled;
      case 'WHITELIST':
        return OyasumiSidecarAutomationsState_AutoAcceptInviteRequests_Mode.Whitelist;
      case 'BLACKLIST':
        return OyasumiSidecarAutomationsState_AutoAcceptInviteRequests_Mode.Blacklist;
    }
  }

  private mapMicrophoneActivityMode(mode: 'VRCHAT' | 'HARDWARE'): MicrophoneActivityMode {
    switch (mode) {
      case 'VRCHAT':
        return MicrophoneActivityMode.VRChat;
      case 'HARDWARE':
        return MicrophoneActivityMode.Hardware;
    }
  }

  private mapOVRDevice(
    device: OVRDevice
  ): OyasumiSidecarDeviceInfo_Controller | OyasumiSidecarDeviceInfo_Tracker {
    switch (device.class) {
      case 'Controller':
        return {
          index: device.index,
          manufacturerName: device.manufacturerName,
          modelNumber: device.modelNumber,
          serialNumber: device.serialNumber,
          hardwareRevision: device.hardwareRevision,
          dongleId: device.dongleId,
          battery: device.battery,
          isTurningOff: device.isTurningOff,
          canPowerOff: device.canPowerOff,
          isCharging: device.isCharging,
          providesBatteryStatus: device.providesBatteryStatus,
        } as OyasumiSidecarDeviceInfo_Controller;
      case 'GenericTracker':
        return {
          index: device.index,
          manufacturerName: device.manufacturerName,
          modelNumber: device.modelNumber,
          serialNumber: device.serialNumber,
          hardwareRevision: device.hardwareRevision,
          dongleId: device.dongleId,
          battery: device.battery,
          isTurningOff: device.isTurningOff,
          canPowerOff: device.canPowerOff,
          isCharging: device.isCharging,
          providesBatteryStatus: device.providesBatteryStatus,
        } as OyasumiSidecarDeviceInfo_Tracker;
      default:
        throw 'Received unsupported device class';
    }
  }
}
