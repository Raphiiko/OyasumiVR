import { Component, DestroyRef } from '@angular/core';
import { SelectBoxItem } from '../../../../components/select-box/select-box.component';
import { AutomationConfigService } from '../../../../services/automation-config.service';
import { DomSanitizer } from '@angular/platform-browser';
import { VRChatMicMuteAutomationService } from '../../../../services/osc-automations/vrchat-mic-mute-automation.service';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { combineLatest, map } from 'rxjs';
import { AudioDeviceService } from '../../../../services/audio-device.service';

@Component({
  selector: 'app-system-mic-mute-automations-view',
  templateUrl: './system-mic-mute-automations-view.component.html',
  styleUrls: ['./system-mic-mute-automations-view.component.scss'],
})
export class SystemMicMuteAutomationsViewComponent {
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
      label: 'systemMicMuteAutomations.controlButtonBehavior.TOGGLE',
    },
    {
      id: 'TOGGLE',
      label: 'systemMicMuteAutomations.controlButtonBehavior.PUSH_TO_TALK',
    },
  ];
  controlButtonBehaviorOption: SelectBoxItem | undefined;
  audioDeviceOptions: SelectBoxItem[] = [];
  audioDeviceOption: SelectBoxItem | undefined;
  controlButtonOptions: SelectBoxItem[] = [
    {
      id: 'NONE',
      label: 'systemMicMuteAutomations.controlButton.NONE',
    },
    {
      id: 'LEFT_A',
      label: 'systemMicMuteAutomations.controlButton.LEFT_A',
    },
    {
      id: 'RIGHT_A',
      label: 'systemMicMuteAutomations.controlButton.RIGHT_A',
    },
    {
      id: 'LEFT_B',
      label: 'systemMicMuteAutomations.controlButton.LEFT_B',
    },
    {
      id: 'RIGHT_B',
      label: 'systemMicMuteAutomations.controlButton.RIGHT_B',
    },
    {
      id: 'LEFT_STICK',
      label: 'systemMicMuteAutomations.controlButton.LEFT_STICK',
    },
    {
      id: 'RIGHT_STICK',
      label: 'systemMicMuteAutomations.controlButton.RIGHT_STICK',
    },
  ];
  controlButtonOption: SelectBoxItem | undefined;

  constructor(
    private automationConfigService: AutomationConfigService,
    private destroyRef: DestroyRef,
    private domSanitizer: DomSanitizer,
    protected automation: VRChatMicMuteAutomationService,
    private audioDeviceService: AudioDeviceService
  ) {}

  async ngOnInit() {
    this.automationConfigService.configs
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        map((configs) => configs.VRCHAT_MIC_MUTE_AUTOMATIONS)
      )
      .subscribe((config) => {
        this.onSleepEnableMuteOption = this.muteActionOptions.find(
          (o) => o.id === config.onSleepModeEnable
        );
        this.onSleepDisableMuteOption = this.muteActionOptions.find(
          (o) => o.id === config.onSleepModeDisable
        );
        this.onSleepPreparationMuteOption = this.muteActionOptions.find(
          (o) => o.id === config.onSleepPreparation
        );
      });

    combineLatest([this.audioDeviceService.activeDevices])
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(([devices]) => {
        this.audioDeviceOptions = devices
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
      });
  }

  onChangeAudioDevice($event: SelectBoxItem | undefined) {
    if (!$event) return;
  }

  onChangeControlButtonBehaviorOption($event: SelectBoxItem | undefined) {
    if (!$event) return;
    // this.automationConfigService.updateAutomationConfig<VRChatMicMuteAutomationsConfig>(
    //   'VRCHAT_MIC_MUTE_AUTOMATIONS',
    //   {
    //     mode: $event.id as VRChatVoiceMode,
    //   }
    // );
  }

  onChangeControlButtonOption($event: SelectBoxItem | undefined) {
    if (!$event) return;
    // this.automationConfigService.updateAutomationConfig<VRChatMicMuteAutomationsConfig>(
    //   'VRCHAT_MIC_MUTE_AUTOMATIONS',
    //   {
    //     mode: $event.id as VRChatVoiceMode,
    //   }
    // );
  }

  async onChangeMuteOption(
    automation: 'ON_SLEEP_ENABLE' | 'ON_SLEEP_DISABLE' | 'ON_SLEEP_PREPARATION',
    option: SelectBoxItem | undefined
  ) {
    if (!option) return;
    const keyMap = {
      ON_SLEEP_ENABLE: 'onSleepModeEnable',
      ON_SLEEP_DISABLE: 'onSleepModeDisable',
      ON_SLEEP_PREPARATION: 'onSleepPreparation',
    };
    const key = keyMap[automation];
    // await this.automationConfigService.updateAutomationConfig<VRChatMicMuteAutomationsConfig>(
    //   'VRCHAT_MIC_MUTE_AUTOMATIONS',
    //   {
    //     [key]: option!.id as 'MUTE' | 'UNMUTE' | 'NONE',
    //   }
    // );
  }
}
