import { Component, DestroyRef, OnInit } from '@angular/core';
import { SelectBoxItem } from '../../../../components/select-box/select-box.component';
import { debounceTime, distinctUntilChanged, map, skip, Subject, tap } from 'rxjs';
import { VRChatService } from '../../../../services/vrchat-api/vrchat.service';
import { hshrink, noop, vshrink } from '../../../../utils/animations';
import { isEqual } from 'lodash';
import {
  AutoAcceptInviteRequestsAutomationConfig,
  AUTOMATION_CONFIGS_DEFAULT,
} from '../../../../models/automations';
import { AutomationConfigService } from '../../../../services/automation-config.service';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AppSettingsService } from '../../../../services/app-settings.service';

interface PresetOptions {
  onSleepEnable: SelectBoxItem;
  onSleepDisable: SelectBoxItem;
  onSleepPreparation: SelectBoxItem;
}

@Component({
  selector: 'app-auto-invite-request-accept-view',
  templateUrl: './auto-invite-request-accept-view.component.html',
  styleUrls: ['./auto-invite-request-accept-view.component.scss'],
  animations: [vshrink(), noop(), hshrink()],
  standalone: false,
})
export class AutoInviteRequestAcceptViewComponent implements OnInit {
  loggedIn = false;
  listModeOption?: SelectBoxItem;
  listModeOptions: SelectBoxItem[] = [
    {
      id: 'DISABLED',
      label: 'auto-invite-request-accept.options.listMode.options.DISABLED.label',
      subLabel: 'auto-invite-request-accept.options.listMode.options.DISABLED.subLabel',
    },
    {
      id: 'WHITELIST',
      label: 'auto-invite-request-accept.options.listMode.options.WHITELIST.label',
      subLabel: 'auto-invite-request-accept.options.listMode.options.WHITELIST.subLabel',
    },
    {
      id: 'BLACKLIST',
      label: 'auto-invite-request-accept.options.listMode.options.BLACKLIST.label',
      subLabel: 'auto-invite-request-accept.options.listMode.options.BLACKLIST.subLabel',
    },
  ];
  config: AutoAcceptInviteRequestsAutomationConfig = structuredClone(
    AUTOMATION_CONFIGS_DEFAULT.AUTO_ACCEPT_INVITE_REQUESTS
  );
  isOnBusyStatus = false;
  isOnJoinMeStatus = false;
  presetOptions: SelectBoxItem[] = [
    {
      id: 'NONE',
      label: 'auto-invite-request-accept.options.presetOptions.options.NONE',
    },
  ];
  presetOption: PresetOptions = {
    onSleepEnable: this.presetOptions[0],
    onSleepDisable: this.presetOptions[0],
    onSleepPreparation: this.presetOptions[0],
  };
  playerIds: string[] = [];
  protected declineOnRequestOptions: SelectBoxItem[] = [
    {
      id: 'ALWAYS',
      label: 'auto-invite-request-accept.options.declineOnRequest.options.ALWAYS',
      subLabel: '',
    },
    {
      id: 'WHEN_SLEEPING',
      label: 'auto-invite-request-accept.options.declineOnRequest.options.WHEN_SLEEPING',
      subLabel: '',
    },
    {
      id: 'DISABLED',
      label: 'auto-invite-request-accept.options.declineOnRequest.options.DISABLED',
      subLabel: '',
    },
  ];
  protected declineOnRequestOption: SelectBoxItem | undefined;
  protected updateAcceptInviteRequestCustomMessage = new Subject<string>();
  protected updateDeclineInviteRequestCustomMessage = new Subject<string>();
  protected updateDeclineInviteWhileAsleepCustomMessage = new Subject<string>();

  constructor(
    protected vrchat: VRChatService,
    private automationConfig: AutomationConfigService,
    private appSettings: AppSettingsService,
    private destroyRef: DestroyRef
  ) {}

  ngOnInit(): void {
    this.vrchat.status
      .pipe(takeUntilDestroyed(this.destroyRef), distinctUntilChanged())
      .subscribe(async (status) => {
        this.loggedIn = status === 'LOGGED_IN';
      });
    this.vrchat.user.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((user) => {
      this.isOnBusyStatus = user?.status === 'busy';
      this.isOnJoinMeStatus = user?.status === 'join me';
    });
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
          // Reset options to NONE if the set preset could no longer be found
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
        const playersChanged = !isEqual(
          [...this.config.playerIds].sort(),
          [...this.playerIds].sort()
        );
        if (playersChanged) {
          this.playerIds = [...this.config.playerIds];
        }
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
    this.updateDeclineInviteWhileAsleepCustomMessage
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        debounceTime(500),
        map((message) => message.trim().replace(/\s+/g, ' ').slice(0, 64)),
        distinctUntilChanged()
      )
      .subscribe((message) => {
        this.updateConfig({ declineInviteMessage: message });
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

  async updatePlayerIds(playerIds: string[]) {
    this.playerIds = playerIds;
    await this.updateConfig({ playerIds });
  }

  public async setDeclineOnRequestOption(optionId?: string) {
    if (!optionId || !this.declineOnRequestOptions.map((o) => o.id).includes(optionId)) return;
    await this.updateConfig({
      declineOnRequest: optionId as 'DISABLED' | 'WHEN_SLEEPING' | 'ALWAYS',
    });
  }
}
