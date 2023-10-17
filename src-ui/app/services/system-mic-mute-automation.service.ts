import { Injectable } from '@angular/core';
import { AudioDeviceService } from './audio-device.service';
import { OpenVRInputService } from './openvr-input.service';
import { AutomationConfigService } from './automation-config.service';
import {
  combineLatest,
  distinctUntilChanged,
  filter,
  firstValueFrom,
  map,
  pairwise,
  skip,
  switchMap,
  take,
  tap,
} from 'rxjs';
import { AudioDevice } from '../models/audio-device';
import { SleepService } from './sleep.service';
import { AUTOMATION_CONFIGS_DEFAULT, SystemMicMuteAutomationsConfig } from '../models/automations';
import { cloneDeep, isEqual } from 'lodash';
import { info } from 'tauri-plugin-log-api';
import { SleepPreparationService } from './sleep-preparation.service';
import { OVRInputEventAction } from '../models/ovr-input-event';

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
    switchMap(async ([config, activeDevices]) =>
      this.getAudioDeviceForPersistentId(config.audioDevicePersistentId)
    )
  );

  public readonly isMicMuted = this.captureDevice.pipe(map((device) => device?.mute ?? null));

  constructor(
    private automationConfigService: AutomationConfigService,
    private audioDeviceService: AudioDeviceService,
    private openvrInputService: OpenVRInputService,
    private sleepService: SleepService,
    private sleepPreparationService: SleepPreparationService
  ) {}

  async init() {
    this.automationConfigService.configs
      .pipe(map((configs) => configs.SYSTEM_MIC_MUTE_AUTOMATIONS))
      .subscribe((config) => {
        this.config = config;
      });
    this.changeMuteOnSleepEnable();
    this.changeMuteOnSleepDisable();
    this.changeMuteOnSleepPreparation();
    this.handleControllerBinding();
    this.changeControllerBindingBehaviorOnSleepEnable();
    this.changeControllerBindingBehaviorOnSleepDisable();
    this.changeControllerBindingBehaviorOnSleepPreparation();
  }

  private changeMuteOnSleepEnable() {
    this.sleepService.mode
      .pipe(
        skip(1),
        filter((mode) => mode),
        map(() => this.config.onSleepModeEnableState),
        filter((state) => state !== 'NONE'),
        map((state) => state === 'MUTE'),
        switchMap((state) => this.setMute(state)),
        tap((stateSet) => {
          if (stateSet !== null) {
            info(
              `[SystemMicMuteAutomation] Setting mic mute to ${stateSet} as the sleep mode was enabled`
            );
            // TODO: LOG EVENT
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
        switchMap((state) => this.setMute(state)),
        tap((stateSet) => {
          if (stateSet !== null) {
            info(
              `[SystemMicMuteAutomation] Setting mic mute to ${stateSet} as the sleep mode was disabled`
            );
            // TODO: LOG EVENT
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
        switchMap((state) => this.setMute(state)),
        tap((stateSet) => {
          if (stateSet !== null) {
            info(
              `[SystemMicMuteAutomation] Setting mic mute to ${stateSet} as the user prepared to go to sleep`
            );
            // TODO: LOG EVENT
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
      })
    );

    // Respond to button presses
    buttonPressed$.subscribe(async (pressed) => {
      buttonPressed = pressed;
      switch (this.config.controllerBindingBehavior) {
        case 'TOGGLE':
          const isMuted = await firstValueFrom(this.isMicMuted);
          if (isMuted === null) break;
          if (pressed) await this.setMute(!isMuted);
          break;
        case 'PUSH_TO_TALK':
          await this.setMute(!pressed);
          break;
      }
    });
    // Reevaluate mute state when the behavior changes
    this.automationConfigService.configs
      .pipe(
        map((configs) => configs.SYSTEM_MIC_MUTE_AUTOMATIONS.controllerBindingBehavior),
        distinctUntilChanged(),
        switchMap(async (behavior) => {
          console.log(1);
          if (behavior === 'PUSH_TO_TALK') {
            console.log(2);
            await this.setMute(!buttonPressed);
            console.log(3);
          }
          console.log(4);
        })
      )
      .subscribe();
  }

  private changeControllerBindingBehaviorOnSleepEnable() {
    this.sleepService.mode
      .pipe(
        skip(1),
        filter((mode) => mode),
        map(() => this.config.onSleepModeEnableControllerBindingBehavior),
        filter((state) => state !== 'NONE'),
        // TODO: CHANGE MODE
        tap((modeSet) => {
          if (modeSet !== null) {
            // TODO: LOG
            // TODO: LOG EVENT
          }
        })
      )
      .subscribe();
  }

  private changeControllerBindingBehaviorOnSleepDisable() {}

  private changeControllerBindingBehaviorOnSleepPreparation() {}

  private async setMute(mute: boolean) {
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
    return 'CAPTURE_DEVICE_[' + device.name + ']';
  }

  public async getAudioDeviceNameForPersistentId(id: string): Promise<string | null> {
    let devices = await firstValueFrom(this.audioDeviceService.activeDevices);
    if (id === 'DEFAULT') return devices.find((d) => d.default)?.name ?? null;
    const lead = 'CAPTURE_DEVICE_[';
    const trail = ']';
    if (!id.startsWith(lead) || !id.endsWith(trail)) return null;
    return id.substring(lead.length, id.length - trail.length);
  }

  public async getAudioDeviceForPersistentId(
    id: string | undefined | null
  ): Promise<AudioDevice | null> {
    if (!id) return null;
    let devices = await firstValueFrom(this.audioDeviceService.activeDevices);
    if (id === 'DEFAULT') return devices.find((d) => d.default) ?? null;
    const lead = 'CAPTURE_DEVICE_[';
    const trail = ']';
    if (!id.startsWith(lead) || !id.endsWith(trail)) return null;
    const name = id.substring(lead.length, id.length - trail.length);
    return devices.find((d) => d.name === name) ?? null;
  }
}
