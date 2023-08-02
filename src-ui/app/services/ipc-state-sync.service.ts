import { Injectable } from '@angular/core';
import { SleepService } from './sleep.service';
import { VRChatService } from './vrchat.service';
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
import { cloneDeep, isEqual } from 'lodash';
import { UserStatus } from 'vrchat';
import { IPCService } from './ipc.service';
import { AutomationConfigService } from './automation-config.service';
import {
  OyasumiSidecarAutomationsState_AutoAcceptInviteRequests_Mode,
  OyasumiSidecarDeviceInfo,
  OyasumiSidecarDeviceInfo_Controller,
  OyasumiSidecarDeviceInfo_Tracker,
  OyasumiSidecarOverlayActivationAction,
  OyasumiSidecarOverlayActivationController,
  OyasumiSidecarOverlaySettings,
  OyasumiSidecarState,
  VrcStatus,
} from '../../../src-grpc-web-client/overlay-sidecar_pb';
import { AUTOMATION_CONFIGS_DEFAULT, AutomationConfigs } from '../models/automations';
import { TranslateService } from '@ngx-translate/core';
import { SLEEPING_ANIMATION_PRESETS } from '../models/sleeping-animation-presets';
import { AppSettingsService } from './app-settings.service';
import {
  ShutdownAutomationsService,
  ShutdownSequenceStageOrder,
} from './shutdown-automations.service';
import { OpenVRService } from './openvr.service';
import { OVRDevice } from '../models/ovr-device';
import {
  APP_SETTINGS_DEFAULT,
  OverlayActivationAction,
  OverlayActivationController,
} from '../models/settings';

@Injectable({
  providedIn: 'root',
})
export class IPCStateSyncService {
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
        sleepTriggerEnabled: AUTOMATION_CONFIGS_DEFAULT.SHUTDOWN_AUTOMATIONS.triggerOnSleep,
        timeDelay: AUTOMATION_CONFIGS_DEFAULT.SHUTDOWN_AUTOMATIONS.sleepDuration,
        running: false,
        canStart: false,
      },
      sleepModeEnableForSleepDetector: {
        enabled: AUTOMATION_CONFIGS_DEFAULT.SLEEP_MODE_ENABLE_FOR_SLEEP_DETECTOR.enabled,
        sensitivity: AUTOMATION_CONFIGS_DEFAULT.SLEEP_MODE_ENABLE_FOR_SLEEP_DETECTOR.sensitivity
      }
    },
    locale: APP_SETTINGS_DEFAULT.userLanguage,
    deviceInfo: {
      controllers: [],
      trackers: [],
    },
    settings: {
      activationAction: this.mapOverlayActivationAction(
        APP_SETTINGS_DEFAULT.overlayActivationAction
      ),
      activationController: this.mapOverlayActivationController(
        APP_SETTINGS_DEFAULT.overlayActivationController
      ),
      activationTriggerRequired: APP_SETTINGS_DEFAULT.overlayActivationTriggerRequired,
    },
  });

  constructor(
    private sleepService: SleepService,
    private vrchatService: VRChatService,
    private ipcService: IPCService,
    private automationConfig: AutomationConfigService,
    private translate: TranslateService,
    private appSettings: AppSettingsService,
    private shutdownAutomationsService: ShutdownAutomationsService,
    private openvr: OpenVRService
  ) {}

  async init() {
    // Sync state to overlay sidecar
    combineLatest([
      this.state.pipe(distinctUntilChanged((a, b) => isEqual(a, b))),
      this.ipcService.overlaySidecarClient,
    ])
      .pipe(filter(([, client]) => !!client))
      .subscribe(([state, client]) => {
        client!.syncState(state);
      });
    // Update state when sleep mode changes
    this.sleepService.mode.subscribe((sleepMode) => {
      this.state.next({ ...cloneDeep(this.state.value), sleepMode });
    });
    // Update the state when the VRChat user or their status changes.
    this.vrchatService.user.subscribe((user) => {
      this.state.next({
        ...cloneDeep(this.state.value),
        vrcUsername: user?.displayName ?? '',
        vrcStatus: this.mapVRCStatus(user?.status),
      });
    });
    // Update the state when the locale changes
    this.appSettings.settings
      .pipe(
        map((settings) => settings.userLanguage),
        distinctUntilChanged()
      )
      .subscribe((locale) => {
        this.state.next({
          ...cloneDeep(this.state.value),
          locale,
        });
      });
    // Update the state when the automation configs change
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
            'SLEEP_MODE_ENABLE_FOR_SLEEP_DETECTOR'
          ];
          return configIds.some((configId) => !isEqual(oldConfigs[configId], newConfigs[configId]));
        }),
        map(([, configs]) => configs)
      )
      .subscribe((configs) => {
        const state = cloneDeep(this.state.value);
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
          automation.sleepTriggerEnabled = configs.SHUTDOWN_AUTOMATIONS.triggerOnSleep;
          automation.timeDelay = configs.SHUTDOWN_AUTOMATIONS.sleepDuration;
          automation.canStart =
            this.shutdownAutomationsService.getApplicableStages(configs.SHUTDOWN_AUTOMATIONS)
              .length > 0;
        }
        this.state.next(state);
      });
    // Update the state when the shutdown automations state changes
    this.shutdownAutomationsService.stage.subscribe((stage) => {
      const index = ShutdownSequenceStageOrder.indexOf(stage);
      const active = index > 0;
      const state = cloneDeep(this.state.value);
      if (state.automations?.shutdownAutomations?.running !== active) {
        const automation = state.automations!.shutdownAutomations!;
        automation.running = active;
        this.state.next(state);
      }
    });
    // Update the state when OVR devices change
    this.openvr.devices
      .pipe(throttleTime(100, asyncScheduler, { leading: true, trailing: true }))
      .subscribe((devices) => {
        const state = cloneDeep(this.state.value);
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
    // Update the state when the app settings change
    this.appSettings.settings.subscribe((settings) => {
      const state = cloneDeep(this.state.value);
      // Update overlay settings
      state.settings = Object.assign(state.settings ?? {}, {
        activationAction: this.mapOverlayActivationAction(settings.overlayActivationAction),
        activationController: this.mapOverlayActivationController(
          settings.overlayActivationController
        ),
        activationTriggerRequired: settings.overlayActivationTriggerRequired,
      } as OyasumiSidecarOverlaySettings);
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

  private mapOverlayActivationAction(
    action: OverlayActivationAction
  ): OyasumiSidecarOverlayActivationAction {
    switch (action) {
      case 'NONE':
        return OyasumiSidecarOverlayActivationAction.None;
      case 'SINGLE_A':
        return OyasumiSidecarOverlayActivationAction.Single_A;
      case 'SINGLE_B':
        return OyasumiSidecarOverlayActivationAction.Single_B;
      case 'DOUBLE_A':
        return OyasumiSidecarOverlayActivationAction.Double_A;
      case 'DOUBLE_B':
        return OyasumiSidecarOverlayActivationAction.Double_B;
      case 'TRIPLE_A':
        return OyasumiSidecarOverlayActivationAction.Triple_A;
      case 'TRIPLE_B':
        return OyasumiSidecarOverlayActivationAction.Triple_B;
    }
  }

  private mapOverlayActivationController(
    controller: OverlayActivationController
  ): OyasumiSidecarOverlayActivationController {
    switch (controller) {
      case 'EITHER':
        return OyasumiSidecarOverlayActivationController.Either;
      case 'LEFT':
        return OyasumiSidecarOverlayActivationController.Left;
      case 'RIGHT':
        return OyasumiSidecarOverlayActivationController.Right;
    }
  }
}
