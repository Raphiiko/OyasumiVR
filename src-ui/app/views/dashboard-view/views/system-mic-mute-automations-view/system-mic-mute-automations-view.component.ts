import { Component, DestroyRef, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { SelectBoxItem } from '../../../../components/select-box/select-box.component';
import { AutomationConfigService } from '../../../../services/automation-config.service';
import { DomSanitizer } from '@angular/platform-browser';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { combineLatest, distinctUntilChanged, map } from 'rxjs';
import { AudioDeviceService } from '../../../../services/audio-device.service';
import {
  AUTOMATION_CONFIGS_DEFAULT,
  SystemMicMuteAutomationsConfig,
  SystemMicMuteControllerBindingBehavior,
  SystemMicMuteStateOption,
  VRChatMicrophoneWorldJoinBehaviour,
} from '../../../../models/automations';
import { cloneDeep, isEqual } from 'lodash';
import { OVRInputEventAction } from '../../../../models/ovr-input-event';
import { fade, vshrink } from '../../../../utils/animations';
import { SystemMicMuteAutomationService } from 'src-ui/app/services/system-mic-mute-automation.service';
import { SliderSettingComponent } from '../../../../components/slider-setting/slider-setting.component';
import { listen, UnlistenFn } from '@tauri-apps/api/event';

@Component({
  selector: 'app-system-mic-mute-automations-view',
  templateUrl: './system-mic-mute-automations-view.component.html',
  styleUrls: ['./system-mic-mute-automations-view.component.scss'],
  animations: [vshrink(), fade()],
})
export class SystemMicMuteAutomationsViewComponent implements OnInit, OnDestroy {
  config: SystemMicMuteAutomationsConfig = cloneDeep(
    AUTOMATION_CONFIGS_DEFAULT.SYSTEM_MIC_MUTE_AUTOMATIONS
  );
  worldJoinBehaviourOptions: SelectBoxItem[] = [
    {
      id: 'KEEP',
      label: 'systemMicMuteAutomations.vrchat.worldJoinBehaviour.options.KEEP',
      htmlPrefix: this.domSanitizer.bypassSecurityTrustHtml(
        '<i class="material-icons" style="margin-right: 0.5em">mic_none</i>'
      ),
    },
    {
      id: 'MUTE',
      label: 'systemMicMuteAutomations.vrchat.worldJoinBehaviour.options.MUTE',
      htmlPrefix: this.domSanitizer.bypassSecurityTrustHtml(
        '<i class="material-icons" style="margin-right: 0.5em">mic_off</i>'
      ),
    },
    {
      id: 'UNMUTE',
      label: 'systemMicMuteAutomations.vrchat.worldJoinBehaviour.options.UNMUTE',
      htmlPrefix: this.domSanitizer.bypassSecurityTrustHtml(
        '<i class="material-icons" style="margin-right: 0.5em">mic</i>'
      ),
    },
  ];
  worldJoinBehaviourOption: SelectBoxItem | undefined;
  muteActionOptions: SelectBoxItem[] = [
    {
      id: 'NONE',
      label: 'systemMicMuteAutomations.muteOptions.NONE',
      htmlPrefix: this.domSanitizer.bypassSecurityTrustHtml(
        '<i class="material-icons" style="margin-right: 0.5em">mic_none</i>'
      ),
    },
    {
      id: 'MUTE',
      label: 'systemMicMuteAutomations.muteOptions.MUTE',
      htmlPrefix: this.domSanitizer.bypassSecurityTrustHtml(
        '<i class="material-icons" style="margin-right: 0.5em">mic_off</i>'
      ),
    },
    {
      id: 'UNMUTE',
      label: 'systemMicMuteAutomations.muteOptions.UNMUTE',
      htmlPrefix: this.domSanitizer.bypassSecurityTrustHtml(
        '<i class="material-icons" style="margin-right: 0.5em">mic</i>'
      ),
    },
  ];
  onSleepEnableMuteOption: SelectBoxItem | undefined;
  onSleepDisableMuteOption: SelectBoxItem | undefined;
  onSleepPreparationMuteOption: SelectBoxItem | undefined;
  controlButtonBehaviorOptions: SelectBoxItem[] = [
    {
      id: 'TOGGLE',
      label: 'systemMicMuteAutomations.controllerBinding.mode.options.TOGGLE',
    },
    {
      id: 'PUSH_TO_TALK',
      label: 'systemMicMuteAutomations.controllerBinding.mode.options.PUSH_TO_TALK',
    },
  ];
  controlButtonBehaviorOption: SelectBoxItem | undefined;
  audioDeviceOptions: SelectBoxItem[] = [];
  audioDeviceOption: SelectBoxItem | undefined;
  controlButtonBehaviorAutomationOptions: SelectBoxItem[] = [
    {
      id: 'NONE',
      label: 'systemMicMuteAutomations.controllerBinding.mode.options.NONE',
    },
    ...this.controlButtonBehaviorOptions,
  ];
  onSleepEnableControlButtonBehaviorOption: SelectBoxItem | undefined;
  onSleepDisableControlButtonBehaviorOption: SelectBoxItem | undefined;
  onSleepPreparationControlButtonBehaviorOption: SelectBoxItem | undefined;
  voiceActivationModeOptions: SelectBoxItem[] = [
    {
      id: 'VRCHAT',
      label: 'systemMicMuteAutomations.overlayIndicator.voiceActivityMode.modes.VRCHAT',
    },
    {
      id: 'HARDWARE',
      label: 'systemMicMuteAutomations.overlayIndicator.voiceActivityMode.modes.HARDWARE',
    },
  ];
  voiceActivationModeOption: SelectBoxItem | undefined;
  micLevelUnlisten?: UnlistenFn;

  @ViewChild('voiceActivationThresholdSlider')
  voiceActivationThresholdSlider?: SliderSettingComponent;

  constructor(
    private automationConfigService: AutomationConfigService,
    private destroyRef: DestroyRef,
    private domSanitizer: DomSanitizer,
    private audioDeviceService: AudioDeviceService,
    protected systemMicMuteAutomationService: SystemMicMuteAutomationService
  ) {}

  async ngOnInit() {
    // Obtain config changes
    const $config = this.automationConfigService.configs.pipe(
      takeUntilDestroyed(this.destroyRef),
      map((configs) => configs.SYSTEM_MIC_MUTE_AUTOMATIONS),
      distinctUntilChanged((a, b) => isEqual(a, b))
    );
    // Process config changes
    $config.subscribe((config) => {
      this.config = config;
      this.onSleepEnableMuteOption = this.muteActionOptions.find(
        (o) => o.id === config.onSleepModeEnableState
      );
      this.onSleepDisableMuteOption = this.muteActionOptions.find(
        (o) => o.id === config.onSleepModeDisableState
      );
      this.onSleepPreparationMuteOption = this.muteActionOptions.find(
        (o) => o.id === config.onSleepPreparationState
      );
      this.onSleepEnableControlButtonBehaviorOption =
        this.controlButtonBehaviorAutomationOptions.find(
          (o) => o.id === config.onSleepModeEnableControllerBindingBehavior
        );
      this.onSleepDisableControlButtonBehaviorOption =
        this.controlButtonBehaviorAutomationOptions.find(
          (o) => o.id === config.onSleepModeDisableControllerBindingBehavior
        );
      this.onSleepPreparationControlButtonBehaviorOption =
        this.controlButtonBehaviorAutomationOptions.find(
          (o) => o.id === config.onSleepPreparationControllerBindingBehavior
        );
      this.controlButtonBehaviorOption = this.controlButtonBehaviorOptions.find(
        (o) => o.id === config.controllerBindingBehavior
      );
      this.voiceActivationModeOption = this.voiceActivationModeOptions.find(
        (o) => o.id === config.voiceActivationMode
      );
      this.worldJoinBehaviourOption = this.worldJoinBehaviourOptions.find(
        (o) => o.id === config.vrchatWorldJoinBehaviour
      );
    });
    // Process audio devices and config related to audio devices
    combineLatest([
      this.audioDeviceService.activeDevices,
      $config.pipe(map((c) => c.audioDevicePersistentId)),
    ])
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(async ([devices, audioDevicePersistedId]) => {
        let options: SelectBoxItem[] = devices
          .filter((d) => d.deviceType === 'Capture')
          .map((d) => {
            return {
              id: d.persistentId!,
              label: (d.parsedName!.display + '\n' + d.parsedName!.driver).trim(),
            };
          });
        // Add default option
        const device = devices.find((d) => d.default && d.deviceType === 'Capture');
        if (device) {
          const defaultOption: SelectBoxItem = {
            id: 'DEFAULT_CAPTURE',
            label: {
              string: 'systemMicMuteAutomations.audioDevice.options.DEFAULT',
              values: {
                deviceName: (device.parsedName!.display + '\n' + device.parsedName!.driver).trim(),
              },
            },
          };
          options = [defaultOption, ...options];
        }
        // Match the current config to an audio device
        let option = null;
        if (audioDevicePersistedId) {
          option = options.find((o) => o.id === audioDevicePersistedId);
          // If we cannot find the option, we'll insert it.
          // This is in case the user has previously a configured a device that is currently not active.
          if (!option) {
            const name =
              this.audioDeviceService.getAudioDeviceNameForPersistentId(audioDevicePersistedId);
            option = {
              id: audioDevicePersistedId,
              label: name ? (name.display + '\n' + name.driver).trim() : 'Unknown Device',
            };
            options = [option, ...options];
          }
        }
        // Set the options
        this.audioDeviceOptions = options;
        this.audioDeviceOption = option ?? undefined;
      });
    // Process mic audio level for visualisation
    this.micLevelUnlisten = await listen<{ deviceId: string; level: number }>('mic_level', (e) => {
      if (this.voiceActivationThresholdSlider) {
        this.voiceActivationThresholdSlider.audioLevel = e.payload.level;
      }
    });
  }

  ngOnDestroy() {
    if (this.micLevelUnlisten) this.micLevelUnlisten();
  }

  async onChangeAudioDevice($event: SelectBoxItem | undefined) {
    if (!$event) return;
    await this.automationConfigService.updateAutomationConfig<SystemMicMuteAutomationsConfig>(
      'SYSTEM_MIC_MUTE_AUTOMATIONS',
      {
        audioDevicePersistentId: $event.id,
      }
    );
  }

  async onChangeControlButtonBehaviorOption($event: SelectBoxItem | undefined) {
    if (!$event) return;
    this.systemMicMuteAutomationService.setDefaultControlButtonBehavior(
      $event.id as SystemMicMuteControllerBindingBehavior
    );
  }

  async onChangeMuteOption(
    automation: 'ON_SLEEP_ENABLE' | 'ON_SLEEP_DISABLE' | 'ON_SLEEP_PREPARATION',
    option: SelectBoxItem | undefined
  ) {
    if (!option) return;
    const keyMap = {
      ON_SLEEP_ENABLE: 'onSleepModeEnableState',
      ON_SLEEP_DISABLE: 'onSleepModeDisableState',
      ON_SLEEP_PREPARATION: 'onSleepPreparationState',
    };
    const key = keyMap[automation];
    await this.automationConfigService.updateAutomationConfig<SystemMicMuteAutomationsConfig>(
      'SYSTEM_MIC_MUTE_AUTOMATIONS',
      {
        [key]: option!.id as SystemMicMuteStateOption,
      }
    );
  }

  async onChangeControlButtonBehaviorAutomationOption(
    automation: 'ON_SLEEP_ENABLE' | 'ON_SLEEP_DISABLE' | 'ON_SLEEP_PREPARATION',
    option: SelectBoxItem | undefined
  ) {
    if (!option) return;
    const keyMap = {
      ON_SLEEP_ENABLE: 'onSleepModeEnableControllerBindingBehavior',
      ON_SLEEP_DISABLE: 'onSleepModeDisableControllerBindingBehavior',
      ON_SLEEP_PREPARATION: 'onSleepPreparationControllerBindingBehavior',
    };
    const key = keyMap[automation];
    await this.automationConfigService.updateAutomationConfig<SystemMicMuteAutomationsConfig>(
      'SYSTEM_MIC_MUTE_AUTOMATIONS',
      {
        [key]: option!.id as SystemMicMuteControllerBindingBehavior | 'NONE',
      }
    );
  }

  async onChangeOverlayMuteIndicator() {
    await this.automationConfigService.updateAutomationConfig<SystemMicMuteAutomationsConfig>(
      'SYSTEM_MIC_MUTE_AUTOMATIONS',
      {
        overlayMuteIndicator: !this.config.overlayMuteIndicator,
      }
    );
  }

  async onChangeOverlayMuteIndicatorFade() {
    await this.automationConfigService.updateAutomationConfig<SystemMicMuteAutomationsConfig>(
      'SYSTEM_MIC_MUTE_AUTOMATIONS',
      {
        overlayMuteIndicatorFade: !this.config.overlayMuteIndicatorFade,
      }
    );
  }

  async onChangeControllerBinding() {
    await this.automationConfigService.updateAutomationConfig<SystemMicMuteAutomationsConfig>(
      'SYSTEM_MIC_MUTE_AUTOMATIONS',
      {
        controllerBinding: !this.config.controllerBinding,
      }
    );
  }

  async onChangeMuteSoundVolume(volume: number) {
    await this.automationConfigService.updateAutomationConfig<SystemMicMuteAutomationsConfig>(
      'SYSTEM_MIC_MUTE_AUTOMATIONS',
      {
        muteSoundVolume: volume,
      }
    );
  }

  async onChangeOverlayMuteIndicatorOpacity(opacity: number) {
    await this.automationConfigService.updateAutomationConfig<SystemMicMuteAutomationsConfig>(
      'SYSTEM_MIC_MUTE_AUTOMATIONS',
      {
        overlayMuteIndicatorOpacity: opacity,
      }
    );
  }

  async onChangeHardwareVoiceActivationThreshold(threshold: number) {
    await this.automationConfigService.updateAutomationConfig<SystemMicMuteAutomationsConfig>(
      'SYSTEM_MIC_MUTE_AUTOMATIONS',
      {
        hardwareVoiceActivationThreshold: threshold,
      }
    );
  }

  async onChangeVoiceActivationMode(option: SelectBoxItem | undefined) {
    if (!option) return;
    await this.automationConfigService.updateAutomationConfig<SystemMicMuteAutomationsConfig>(
      'SYSTEM_MIC_MUTE_AUTOMATIONS',
      {
        voiceActivationMode: option!.id as 'VRCHAT' | 'HARDWARE',
      }
    );
  }

  async onChangeWorldJoinBehaviourOption(option: SelectBoxItem | undefined) {
    if (!option) return;
    await this.automationConfigService.updateAutomationConfig<SystemMicMuteAutomationsConfig>(
      'SYSTEM_MIC_MUTE_AUTOMATIONS',
      {
        vrchatWorldJoinBehaviour: option!.id as VRChatMicrophoneWorldJoinBehaviour,
      }
    );
  }

  protected readonly OVRInputEventAction = OVRInputEventAction;
}
