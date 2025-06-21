import { Component, DestroyRef, Input, OnInit } from '@angular/core';
import { SelectBoxItem } from '../../../../../../components/select-box/select-box.component';
import { debounceTime, distinctUntilChanged, map, skip, Subject, tap } from 'rxjs';
import { VRChatService } from '../../../../../../services/vrchat-api/vrchat.service';
import { noop, vshrink } from '../../../../../../utils/animations';
import {
  AutoAcceptInviteRequestsAutomationConfig,
  AUTOMATION_CONFIGS_DEFAULT,
} from '../../../../../../models/automations';
import { AutomationConfigService } from '../../../../../../services/automation-config.service';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AppSettingsService } from '../../../../../../services/app-settings.service';

interface PresetOptions {
  onSleepEnable: SelectBoxItem;
  onSleepDisable: SelectBoxItem;
  onSleepPreparation: SelectBoxItem;
}

@Component({
  selector: 'app-invite-requests-tab',
  templateUrl: './invite-requests-tab.component.html',
  styleUrls: ['./invite-requests-tab.component.scss'],
  animations: [vshrink(), noop()],
  standalone: false,
})
export class InviteRequestsTabComponent implements OnInit {
  @Input() loggedIn = false;
  @Input() isOnBusyStatus = false;
  @Input() isOnJoinMeStatus = false;

  listModeOption?: SelectBoxItem;
  listModeOptions: SelectBoxItem[] = [
    {
      id: 'DISABLED',
      label: 'invite-and-invite-requests.inviteRequestsTab.options.listMode.options.DISABLED.label',
      subLabel:
        'invite-and-invite-requests.inviteRequestsTab.options.listMode.options.DISABLED.subLabel',
    },
    {
      id: 'WHITELIST',
      label:
        'invite-and-invite-requests.inviteRequestsTab.options.listMode.options.WHITELIST.label',
      subLabel:
        'invite-and-invite-requests.inviteRequestsTab.options.listMode.options.WHITELIST.subLabel',
    },
    {
      id: 'BLACKLIST',
      label:
        'invite-and-invite-requests.inviteRequestsTab.options.listMode.options.BLACKLIST.label',
      subLabel:
        'invite-and-invite-requests.inviteRequestsTab.options.listMode.options.BLACKLIST.subLabel',
    },
  ];
  config: AutoAcceptInviteRequestsAutomationConfig = structuredClone(
    AUTOMATION_CONFIGS_DEFAULT.AUTO_ACCEPT_INVITE_REQUESTS
  );
  presetOptions: SelectBoxItem[] = [
    {
      id: 'NONE',
      label: 'invite-and-invite-requests.inviteRequestsTab.options.presetOptions.options.NONE',
    },
  ];
  presetOption: PresetOptions = {
    onSleepEnable: this.presetOptions[0],
    onSleepDisable: this.presetOptions[0],
    onSleepPreparation: this.presetOptions[0],
  };
  protected declineOnRequestOptions: SelectBoxItem[] = [
    {
      id: 'ALWAYS',
      label: 'invite-and-invite-requests.inviteRequestsTab.options.declineOnRequest.options.ALWAYS',
      subLabel: '',
    },
    {
      id: 'WHEN_SLEEPING',
      label:
        'invite-and-invite-requests.inviteRequestsTab.options.declineOnRequest.options.WHEN_SLEEPING',
      subLabel: '',
    },
    {
      id: 'DISABLED',
      label:
        'invite-and-invite-requests.inviteRequestsTab.options.declineOnRequest.options.DISABLED',
      subLabel: '',
    },
  ];
  protected declineOnRequestOption: SelectBoxItem | undefined;
  protected updateAcceptInviteRequestCustomMessage = new Subject<string>();
  protected updateDeclineInviteRequestCustomMessage = new Subject<string>();

  constructor(
    protected vrchat: VRChatService,
    private automationConfig: AutomationConfigService,
    private appSettings: AppSettingsService,
    private destroyRef: DestroyRef
  ) {}

  ngOnInit(): void {
    this.appSettings.settings
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        map((settings) => settings.playerListPresets),
        distinctUntilChanged(),
        tap((presets) => {
          this.presetOptions = [
            this.presetOptions[0],
            ...presets.map((preset) => ({
              id: preset.id,
              label: preset.name,
            })),
          ];
        }),
        skip(1),
        tap(() => {
          Object.keys(this.presetOption).forEach((key) => {
            const keyT = key as keyof PresetOptions;
            if (
              this.presetOption[keyT].id !== 'NONE' &&
              !this.presetOptions.find((o) => o.id === this.presetOption[keyT].id)
            ) {
              this.presetOption[keyT] = this.presetOptions[0];
            }
          });
        })
      )
      .subscribe();
    this.automationConfig.configs
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(async (configs) => {
        this.config = structuredClone(configs.AUTO_ACCEPT_INVITE_REQUESTS);
        this.listModeOption = this.listModeOptions.find((o) => o.id === this.config.listMode)!;
        this.presetOption['onSleepEnable'] =
          this.presetOptions.find((o) => o.id === this.config.presetOnSleepEnable) ??
          this.presetOptions[0];
        this.presetOption['onSleepDisable'] =
          this.presetOptions.find((o) => o.id === this.config.presetOnSleepDisable) ??
          this.presetOptions[0];
        this.presetOption['onSleepPreparation'] =
          this.presetOptions.find((o) => o.id === this.config.presetOnSleepPreparation) ??
          this.presetOptions[0];
        this.declineOnRequestOption = this.declineOnRequestOptions.find(
          (o) => o.id === this.config.declineOnRequest
        );
      });
    this.updateAcceptInviteRequestCustomMessage
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        debounceTime(500),
        map((message) => message.trim().replace(/\s+/g, ' ').slice(0, 64)),
        distinctUntilChanged()
      )
      .subscribe((message) => {
        this.updateConfig({ acceptInviteRequestMessage: message });
      });
    this.updateDeclineInviteRequestCustomMessage
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        debounceTime(500),
        map((message) => message.trim().replace(/\s+/g, ' ').slice(0, 64)),
        distinctUntilChanged()
      )
      .subscribe((message) => {
        this.updateConfig({ declineInviteRequestMessage: message });
      });
  }

  login() {
    this.vrchat.showLoginModal();
  }

  async updateConfig(config: Partial<AutoAcceptInviteRequestsAutomationConfig>) {
    await this.automationConfig.updateAutomationConfig('AUTO_ACCEPT_INVITE_REQUESTS', config);
  }

  async setListMode(id?: string) {
    if (!id || !this.listModeOptions.map((o) => o.id).includes(id)) return;
    await this.updateConfig({ listMode: id } as Partial<AutoAcceptInviteRequestsAutomationConfig>);
  }

  protected async setPresetOption(automation: keyof PresetOptions, presetId: string | 'NONE') {
    let option = this.presetOptions.find((o) => o.id === presetId)!;
    if (!option) option = this.presetOptions[0];
    this.presetOption[automation] = option;
    switch (automation) {
      case 'onSleepEnable':
        await this.updateConfig({
          presetOnSleepEnable: presetId === 'NONE' ? null : presetId,
        });
        break;
      case 'onSleepDisable':
        await this.updateConfig({
          presetOnSleepDisable: presetId === 'NONE' ? null : presetId,
        });
        break;
      case 'onSleepPreparation':
        await this.updateConfig({
          presetOnSleepPreparation: presetId === 'NONE' ? null : presetId,
        });
        break;
    }
  }

  public async setDeclineOnRequestOption(optionId?: string) {
    if (!optionId || !this.declineOnRequestOptions.map((o) => o.id).includes(optionId)) return;
    await this.updateConfig({
      declineOnRequest: optionId as 'DISABLED' | 'WHEN_SLEEPING' | 'ALWAYS',
    });
  }
}
