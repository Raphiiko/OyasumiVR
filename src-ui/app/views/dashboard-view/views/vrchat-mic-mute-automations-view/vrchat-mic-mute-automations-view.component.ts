import { Component, DestroyRef, OnInit } from '@angular/core';
import { SelectBoxItem } from '../../../../components/select-box/select-box.component';
import { AutomationConfigService } from '../../../../services/automation-config.service';
import { VRChatMicMuteAutomationsConfig, VRChatVoiceMode } from '../../../../models/automations';
import { map } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DomSanitizer } from '@angular/platform-browser';
import { VRChatMicMuteAutomationService } from '../../../../services/osc-automations/vrchat-mic-mute-automation.service';
import { hshrink } from 'src-ui/app/utils/animations';

@Component({
  selector: 'app-vrchat-mic-mute-automations-view',
  templateUrl: './vrchat-mic-mute-automations-view.component.html',
  styleUrls: ['./vrchat-mic-mute-automations-view.component.scss'],
  animations: [hshrink()],
})
export class VRChatMicMuteAutomationsViewComponent implements OnInit {
  modeOptions: SelectBoxItem[] = [
    {
      id: 'TOGGLE',
      label: 'vrchatMicMuteAutomations.modeOptions.TOGGLE',
    },
    {
      id: 'PUSH_TO_MUTE',
      label: 'vrchatMicMuteAutomations.modeOptions.PUSH_TO_MUTE',
    },
  ];
  modeOption: SelectBoxItem | undefined;
  muteActionOptions: SelectBoxItem[] = [
    {
      id: 'NONE',
      label: 'vrchatMicMuteAutomations.muteOptions.NONE',
      htmlPrefix: this.domSanitizer.bypassSecurityTrustHtml(
        '<i class="material-icons" style="margin-right: 0.5em">mic_none</i>'
      ),
    },
    {
      id: 'MUTE',
      label: 'vrchatMicMuteAutomations.muteOptions.MUTE',
      htmlPrefix: this.domSanitizer.bypassSecurityTrustHtml(
        '<i class="material-icons" style="margin-right: 0.5em">mic_off</i>'
      ),
    },
    {
      id: 'UNMUTE',
      label: 'vrchatMicMuteAutomations.muteOptions.UNMUTE',
      htmlPrefix: this.domSanitizer.bypassSecurityTrustHtml(
        '<i class="material-icons" style="margin-right: 0.5em">mic</i>'
      ),
    },
  ];
  onSleepEnableMuteOption: SelectBoxItem | undefined;
  onSleepDisableMuteOption: SelectBoxItem | undefined;
  onSleepPreparationMuteOption: SelectBoxItem | undefined;

  constructor(
    private automationConfigService: AutomationConfigService,
    private destroyRef: DestroyRef,
    private domSanitizer: DomSanitizer,
    protected automation: VRChatMicMuteAutomationService
  ) {}

  async ngOnInit() {
    this.automationConfigService.configs
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        map((configs) => configs.VRCHAT_MIC_MUTE_AUTOMATIONS)
      )
      .subscribe((config) => {
        this.modeOption = this.modeOptions.find((o) => o.id === config.mode);
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
  }

  onChangeModeOption($event: SelectBoxItem | undefined) {
    if (!$event) return;
    this.automationConfigService.updateAutomationConfig<VRChatMicMuteAutomationsConfig>(
      'VRCHAT_MIC_MUTE_AUTOMATIONS',
      {
        mode: $event.id as VRChatVoiceMode,
      }
    );
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
    await this.automationConfigService.updateAutomationConfig<VRChatMicMuteAutomationsConfig>(
      'VRCHAT_MIC_MUTE_AUTOMATIONS',
      {
        [key]: option!.id as 'MUTE' | 'UNMUTE' | 'NONE',
      }
    );
  }
}
