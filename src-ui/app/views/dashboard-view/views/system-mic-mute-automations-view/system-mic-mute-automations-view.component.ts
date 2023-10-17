import { Component, DestroyRef } from '@angular/core';
import { SelectBoxItem } from '../../../../components/select-box/select-box.component';
import { AutomationConfigService } from '../../../../services/automation-config.service';
import { DomSanitizer } from '@angular/platform-browser';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { combineLatest, distinctUntilChanged, map } from 'rxjs';
import { AudioDeviceService } from '../../../../services/audio-device.service';
import {
  AUTOMATION_CONFIGS_DEFAULT,
  SystemMicMuteAutomationsConfig,
  SystemMicMuteControllerBinding,
  SystemMicMuteControllerBindingBehavior,
  SystemMicMuteStateOption,
} from '../../../../models/automations';
import { cloneDeep, isEqual } from 'lodash';

@Component({
  selector: 'app-system-mic-mute-automations-view',
  templateUrl: './system-mic-mute-automations-view.component.html',
  styleUrls: ['./system-mic-mute-automations-view.component.scss'],
})
export class SystemMicMuteAutomationsViewComponent {
  config: SystemMicMuteAutomationsConfig = cloneDeep(
    AUTOMATION_CONFIGS_DEFAULT.SYSTEM_MIC_MUTE_AUTOMATIONS
  );
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
  controlButtonOptions: SelectBoxItem[] = [
    {
      id: 'NONE',
      label: 'systemMicMuteAutomations.controllerBinding.enabled.options.NONE',
    },
    {
      id: 'LEFT_A',
      label: 'systemMicMuteAutomations.controllerBinding.enabled.options.LEFT_A',
    },
    {
      id: 'RIGHT_A',
      label: 'systemMicMuteAutomations.controllerBinding.enabled.options.RIGHT_A',
    },
    {
      id: 'LEFT_B',
      label: 'systemMicMuteAutomations.controllerBinding.enabled.options.LEFT_B',
    },
    {
      id: 'RIGHT_B',
      label: 'systemMicMuteAutomations.controllerBinding.enabled.options.RIGHT_B',
    },
    {
      id: 'LEFT_STICK',
      label: 'systemMicMuteAutomations.controllerBinding.enabled.options.LEFT_STICK',
    },
    {
      id: 'RIGHT_STICK',
      label: 'systemMicMuteAutomations.controllerBinding.enabled.options.RIGHT_STICK',
    },
  ];
  controlButtonOption: SelectBoxItem | undefined;
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

  constructor(
    private automationConfigService: AutomationConfigService,
    private destroyRef: DestroyRef,
    private domSanitizer: DomSanitizer,
    private audioDeviceService: AudioDeviceService
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
      this.controlButtonOption = this.controlButtonOptions.find(
        (o) => o.id === config.controllerBinding
      );
      this.controlButtonBehaviorOption = this.controlButtonBehaviorOptions.find(
        (o) => o.id === config.controllerBindingBehavior
      );
    });
    // Process audio devices and config related to audio devices
    combineLatest([
      this.audioDeviceService.activeDevices,
      $config.pipe(map((c) => c.audioDeviceNameId)),
    ])
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(([devices, audioDeviceNameId]) => {
        let options: SelectBoxItem[] = devices
          .filter((d) => d.deviceType === 'Capture')
          .map((d) => {
            let label = d.name;
            let breakIndex = label.indexOf('(');
            if (breakIndex > -1) {
              label =
                label.substring(0, breakIndex) + '\n' + label.substring(breakIndex, label.length);
            }
            return {
              id: 'CAPTURE_DEVICE_[' + d.name + ']',
              label,
            };
          });
        // Add default option
        const device = devices.find((d) => d.default);
        if (device) {
          let label = device.name;
          let breakIndex = label.indexOf('(');
          if (breakIndex > -1) {
            label =
              label.substring(0, breakIndex) + '\n' + label.substring(breakIndex, label.length);
          }
          const defaultOption: SelectBoxItem = {
            id: 'DEFAULT',
            label: {
              string: 'systemMicMuteAutomations.audioDevice.options.DEFAULT',
              values: { deviceName: label },
            },
          };
          options = [defaultOption, ...options];
        }
        // Match the current config to an audio device
        let option = null;
        if (audioDeviceNameId) {
          option = options.find((o) => o.id === audioDeviceNameId);
          // If we cannot find the option, we'll insert it.
          // This is in case the user has previously a configured a device that is currently not active.
          if (!option) {
            let label = audioDeviceNameId.substring(
              'CAPTURE_DEVICE_['.length,
              audioDeviceNameId.length - 1
            );
            let breakIndex = label.indexOf('(');
            if (breakIndex > -1) {
              label =
                label.substring(0, breakIndex) + '\n' + label.substring(breakIndex, label.length);
            }
            option = {
              id: audioDeviceNameId,
              label,
            };
            options = [option, ...options];
          }
        }
        // Set the options
        this.audioDeviceOptions = options;
        this.audioDeviceOption = option ?? undefined;
      });
  }

  async onChangeAudioDevice($event: SelectBoxItem | undefined) {
    if (!$event) return;
    await this.automationConfigService.updateAutomationConfig<SystemMicMuteAutomationsConfig>(
      'SYSTEM_MIC_MUTE_AUTOMATIONS',
      {
        audioDeviceNameId: $event.id,
      }
    );
  }

  async onChangeControlButtonBehaviorOption($event: SelectBoxItem | undefined) {
    if (!$event) return;
    await this.automationConfigService.updateAutomationConfig<SystemMicMuteAutomationsConfig>(
      'SYSTEM_MIC_MUTE_AUTOMATIONS',
      {
        controllerBindingBehavior: $event.id as SystemMicMuteControllerBindingBehavior,
      }
    );
  }

  async onChangeControlButtonOption($event: SelectBoxItem | undefined) {
    if (!$event) return;
    await this.automationConfigService.updateAutomationConfig<SystemMicMuteAutomationsConfig>(
      'SYSTEM_MIC_MUTE_AUTOMATIONS',
      {
        controllerBinding: $event.id as SystemMicMuteControllerBinding,
      }
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
        [key]: option!.id as SystemMicMuteControllerBindingBehavior,
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
}
