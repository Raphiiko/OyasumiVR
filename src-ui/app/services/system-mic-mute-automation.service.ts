import { Injectable } from '@angular/core';
import { AudioDeviceService } from './audio-device.service';
import { OpenVRInputService } from './openvr-input.service';
import { AutomationConfigService } from './automation-config.service';
import {
  BehaviorSubject,
  combineLatest,
  delay,
  distinctUntilChanged,
  filter,
  firstValueFrom,
  map,
  pairwise,
  shareReplay,
  skip,
  switchMap,
  take,
  tap,
} from 'rxjs';
import { AudioDevice } from '../models/audio-device';
import { SleepService } from './sleep.service';
import {
  AUTOMATION_CONFIGS_DEFAULT,
  SystemMicMuteAutomationsConfig,
  SystemMicMuteControllerBindingBehavior,
} from '../models/automations';
import { cloneDeep, isEqual } from 'lodash';
import { info } from 'tauri-plugin-log-api';
import { SleepPreparationService } from './sleep-preparation.service';
import { OVRInputEventAction } from '../models/ovr-input-event';
import { NotificationService } from './notification.service';
import {
  EventLogChangedSystemMicControllerButtonBehavior,
  EventLogChangedSystemMicMuteState,
} from '../models/event-log-entry';
import { EventLogService } from './event-log.service';
import { invoke } from '@tauri-apps/api';
import { VRChatService } from './vrchat.service';

const PERSISTENT_ID_LEAD = 'CAPTURE_DEVICE_[';
const PERSISTENT_ID_TRAIL = ']';

@Injectable({
  providedIn: 'root',
})
export class SystemMicMuteAutomationService {
  private config: SystemMicMuteAutomationsConfig = cloneDeep(
    AUTOMATION_CONFIGS_DEFAULT.SYSTEM_MIC_MUTE_AUTOMATIONS
  );
  public readonly captureDevice = combineLatest([
    this.automationConfigService.configs.pipe(
      map((configs) => configs.SYSTEM_MIC_MUTE_AUTOMATIONS)
    ),
    this.audioDeviceService.activeDevices,
  ]).pipe(
    switchMap(async ([config]) =>
      this.getAudioDeviceForPersistentId(config.audioDevicePersistentId)
    ),
    shareReplay(1)
  );
  private readonly _effectiveControllerBehaviour =
    new BehaviorSubject<SystemMicMuteControllerBindingBehavior>(
      AUTOMATION_CONFIGS_DEFAULT.SYSTEM_MIC_MUTE_AUTOMATIONS.controllerBindingBehavior
    );
  public readonly effectiveControllerBehaviour = this._effectiveControllerBehaviour.asObservable();

  public readonly isMicMuted = this.captureDevice.pipe(
    map((device) => device?.mute ?? null),
    distinctUntilChanged()
  );

  constructor(
    private automationConfigService: AutomationConfigService,
    private audioDeviceService: AudioDeviceService,
    private openvrInputService: OpenVRInputService,
    private sleepService: SleepService,
    private sleepPreparationService: SleepPreparationService,
    private notificationService: NotificationService,
    private eventLog: EventLogService,
    private vrchat: VRChatService
  ) {}

  async init() {
    // Keep the local configuration copy up to date
    this.automationConfigService.configs
      .pipe(map((configs) => configs.SYSTEM_MIC_MUTE_AUTOMATIONS))
      .subscribe((config) => {
        this.config = config;
      });

    // Handle automations
    this.changeMuteOnSleepEnable();
    this.changeMuteOnSleepDisable();
    this.changeMuteOnSleepPreparation();
    this.changeControllerBindingBehaviorOnSleepEnable();
    this.changeControllerBindingBehaviorOnSleepDisable();
    this.changeControllerBindingBehaviorOnSleepPreparation();
    this.changeMuteOnVRChatWorldChange();
    // Handle voice activity mode
    this.handleVoiceActivitySettingChanges();
    // Handle controller binding
    this.handleControllerBinding();
    // Handle audio metering
    this.handleHardwareAudioMetering();
  }

  private handleVoiceActivitySettingChanges() {
    // Update the hardware mic activity depending on the voice activation mode
    this.automationConfigService.configs
      .pipe(
        map((configs) => configs.SYSTEM_MIC_MUTE_AUTOMATIONS.voiceActivationMode),
        distinctUntilChanged(),
        switchMap((mode) =>
          invoke('set_hardware_mic_activity_enabled', {
            enabled: mode === 'HARDWARE',
          })
        )
      )
      .subscribe();
    // Update the hardware mic activity threshold based on the config
    this.automationConfigService.configs
      .pipe(
        map((configs) => configs.SYSTEM_MIC_MUTE_AUTOMATIONS.hardwareVoiceActivationThreshold),
        distinctUntilChanged(),
        switchMap((threshold) =>
          invoke('set_hardware_mic_activivation_threshold', {
            threshold: threshold / 100,
          })
        )
      )
      .subscribe();
  }

  private changeMuteOnSleepEnable() {
    this.sleepService.mode
      .pipe(
        skip(1),
        filter((mode) => mode),
        map(() => this.config.onSleepModeEnableState),
        filter((state) => state !== 'NONE'),
        map((state) => state === 'MUTE'),
        delay(16), // To ensure this fires _after_ any reevaluation for the controller binding behaviour
        switchMap((state) => this.setMute(state)),
        tap((stateSet) => {
          if (stateSet !== null) {
            info(
              `[SystemMicMuteAutomation] Setting mic mute to ${stateSet} as the sleep mode was enabled`
            );
            this.eventLog.logEvent({
              type: 'changedSystemMicMuteState',
              muted: stateSet.muted,
              deviceName: stateSet.device?.name ?? 'Unknown',
              reason: 'SLEEP_MODE_ENABLED',
            } as EventLogChangedSystemMicMuteState);
          }
        })
      )
      .subscribe();
  }

  private changeMuteOnSleepDisable() {
    this.sleepService.mode
      .pipe(
        skip(1),
        filter((mode) => !mode),
        map(() => this.config.onSleepModeDisableState),
        filter((state) => state !== 'NONE'),
        map((state) => state === 'MUTE'),
        delay(16), // To ensure this fires _after_ any reevaluation for the controller binding behaviour
        switchMap((state) => this.setMute(state)),
        tap((stateSet) => {
          if (stateSet !== null) {
            info(
              `[SystemMicMuteAutomation] Setting mic mute to ${stateSet} as the sleep mode was disabled`
            );
            this.eventLog.logEvent({
              type: 'changedSystemMicMuteState',
              muted: stateSet.muted,
              deviceName: stateSet.device?.name ?? 'Unknown',
              reason: 'SLEEP_MODE_DISABLED',
            } as EventLogChangedSystemMicMuteState);
          }
        })
      )
      .subscribe();
  }

  private changeMuteOnSleepPreparation() {
    this.sleepPreparationService.onSleepPreparation
      .pipe(
        map(() => this.config.onSleepPreparationState),
        filter((state) => state !== 'NONE'),
        map((state) => state === 'MUTE'),
        delay(16), // To ensure this fires _after_ any reevaluation for the controller binding behaviour
        switchMap((state) => this.setMute(state)),
        tap((stateSet) => {
          if (stateSet !== null) {
            info(
              `[SystemMicMuteAutomation] Setting mic mute to ${stateSet} as the user prepared to go to sleep`
            );
            this.eventLog.logEvent({
              type: 'changedSystemMicMuteState',
              muted: stateSet.muted,
              deviceName: stateSet.device?.name ?? 'Unknown',
              reason: 'SLEEP_PREPARATION',
            } as EventLogChangedSystemMicMuteState);
          }
        })
      )
      .subscribe();
  }

  private handleControllerBinding() {
    let buttonPressed = false;
    const buttonPressed$ = this.openvrInputService.state.pipe(
      map((state) => state[OVRInputEventAction.MuteMicrophone].map((d) => d.index)),
      distinctUntilChanged((a, b) => isEqual(a, b)),
      pairwise(),
      map(([oldState, newState]) => {
        return newState.some((d) => !oldState.includes(d));
      }),
      filter(() => this.config.controllerBinding)
    );

    // Respond to button presses
    buttonPressed$.subscribe(async (pressed) => {
      buttonPressed = pressed;
      switch (this._effectiveControllerBehaviour.value) {
        case 'TOGGLE': {
          const isMuted = await firstValueFrom(this.isMicMuted);
          if (isMuted === null) break;
          if (pressed) {
            await this.notificationService.playSound(
              isMuted ? 'mic_unmute' : 'mic_mute',
              this.config.muteSoundVolume / 100
            );
            await this.setMute(!isMuted);
          }
          break;
        }
        case 'PUSH_TO_TALK':
          await this.notificationService.playSound(
            pressed ? 'mic_unmute' : 'mic_mute',
            this.config.muteSoundVolume / 100
          );
          await this.setMute(!pressed);
          break;
      }
    });
    // Reevaluate mute state when the behavior changes
    this._effectiveControllerBehaviour
      .pipe(
        distinctUntilChanged(),
        switchMap(async (behavior) => {
          if (behavior === 'PUSH_TO_TALK') {
            await this.setMute(!buttonPressed);
          }
        })
      )
      .subscribe();
    // Change the effective mute state when the default behavior is changed
    this.automationConfigService.configs
      .pipe(
        map((configs) => configs.SYSTEM_MIC_MUTE_AUTOMATIONS.controllerBindingBehavior),
        distinctUntilChanged()
      )
      .subscribe((behaviour) => this._effectiveControllerBehaviour.next(behaviour));
  }

  private changeControllerBindingBehaviorOnSleepEnable() {
    this.sleepService.mode
      .pipe(
        skip(1),
        filter((mode) => mode),
        map(() => this.config.onSleepModeEnableControllerBindingBehavior),
        filter((state) => state !== 'NONE'),
        filter((state) => state !== this._effectiveControllerBehaviour.value),
        tap((modeSet) => {
          this._effectiveControllerBehaviour.next(
            modeSet as SystemMicMuteControllerBindingBehavior
          );
          info(
            `[SystemMicMuteAutomation] Setting effective controller button behaviour to ${modeSet} as the sleep mode was enabled`
          );
          this.eventLog.logEvent({
            type: 'changedSystemMicControllerButtonBehavior',
            behavior: modeSet,
            reason: 'SLEEP_MODE_ENABLED',
          } as EventLogChangedSystemMicControllerButtonBehavior);
        })
      )
      .subscribe();
  }

  private changeControllerBindingBehaviorOnSleepDisable() {
    this.sleepService.mode
      .pipe(
        skip(1),
        filter((mode) => !mode),
        map(() => this.config.onSleepModeDisableControllerBindingBehavior),
        filter((state) => state !== 'NONE'),
        filter((state) => state !== this._effectiveControllerBehaviour.value),
        tap((modeSet) => {
          this._effectiveControllerBehaviour.next(
            modeSet as SystemMicMuteControllerBindingBehavior
          );
          info(
            `[SystemMicMuteAutomation] Setting effective controller button behaviour to ${modeSet} as the sleep mode was disabled`
          );
          this.eventLog.logEvent({
            type: 'changedSystemMicControllerButtonBehavior',
            behavior: modeSet,
            reason: 'SLEEP_MODE_DISABLED',
          } as EventLogChangedSystemMicControllerButtonBehavior);
        })
      )
      .subscribe();
  }

  private changeControllerBindingBehaviorOnSleepPreparation() {
    this.sleepPreparationService.onSleepPreparation
      .pipe(
        map(() => this.config.onSleepPreparationControllerBindingBehavior),
        filter((state) => state !== 'NONE'),
        filter((state) => state !== this._effectiveControllerBehaviour.value),
        tap((modeSet) => {
          this._effectiveControllerBehaviour.next(
            modeSet as SystemMicMuteControllerBindingBehavior
          );
          info(
            `[SystemMicMuteAutomation] Setting effective controller button behaviour to ${modeSet} as the user prepared to go to sleep`
          );
          this.eventLog.logEvent({
            type: 'changedSystemMicControllerButtonBehavior',
            behavior: modeSet,
            reason: 'SLEEP_PREPARATION',
          } as EventLogChangedSystemMicControllerButtonBehavior);
        })
      )
      .subscribe();
  }

  private changeMuteOnVRChatWorldChange() {
    this.vrchat.world
      .pipe(
        map((w) => w.instanceId),
        skip(1),
        filter(Boolean),
        distinctUntilChanged()
      )
      .subscribe(async () => {
        switch (this.config.vrchatWorldJoinBehaviour) {
          case 'MUTE':
            await this.setMute(true);
            break;
          case 'UNMUTE':
            await this.setMute(false);
            break;
          case 'KEEP':
            break;
        }
      });
  }

  private async handleHardwareAudioMetering() {
    this.captureDevice
      .pipe(
        map((device) => device?.id ?? null),
        distinctUntilChanged(),
        switchMap((deviceId) => invoke('set_mic_activity_device_id', { deviceId }))
      )
      .subscribe();
  }

  private async setMute(mute: boolean): Promise<{
    muted: boolean;
    device: AudioDevice;
  } | null> {
    const device = await firstValueFrom(this.captureDevice);
    if (!device) return null;
    return await this.audioDeviceService.setMute(device.id, mute);
  }

  public toggleMute() {
    this.isMicMuted
      .pipe(
        take(1),
        filter((mute) => mute !== null),
        map((mute) => !mute),
        switchMap((mute) => this.setMute(mute))
      )
      .subscribe();
  }

  public getPersistentIdForAudioDevice(device: AudioDevice): string {
    return PERSISTENT_ID_LEAD + device.name + PERSISTENT_ID_TRAIL;
  }

  public async getAudioDeviceNameForPersistentId(id: string): Promise<string | null> {
    const devices = await firstValueFrom(this.audioDeviceService.activeDevices);
    if (id === 'DEFAULT') return devices.find((d) => d.default)?.name ?? null;
    if (!id.startsWith(PERSISTENT_ID_LEAD) || !id.endsWith(PERSISTENT_ID_TRAIL)) return null;
    return id.substring(PERSISTENT_ID_LEAD.length, id.length - PERSISTENT_ID_TRAIL.length);
  }

  public async getAudioDeviceForPersistentId(
    id: string | undefined | null
  ): Promise<AudioDevice | null> {
    if (!id) return null;
    const devices = await firstValueFrom(this.audioDeviceService.activeDevices);
    if (id === 'DEFAULT') return devices.find((d) => d.default) ?? null;
    if (!id.startsWith(PERSISTENT_ID_LEAD) || !id.endsWith(PERSISTENT_ID_TRAIL)) return null;
    const name = id.substring(PERSISTENT_ID_LEAD.length, id.length - PERSISTENT_ID_TRAIL.length);
    return devices.find((d) => d.name === name) ?? null;
  }

  async setDefaultControlButtonBehavior(
    controllerBindingBehavior: SystemMicMuteControllerBindingBehavior
  ) {
    this._effectiveControllerBehaviour.next(controllerBindingBehavior);
    await this.automationConfigService.updateAutomationConfig<SystemMicMuteAutomationsConfig>(
      'SYSTEM_MIC_MUTE_AUTOMATIONS',
      {
        controllerBindingBehavior,
      }
    );
  }
}
