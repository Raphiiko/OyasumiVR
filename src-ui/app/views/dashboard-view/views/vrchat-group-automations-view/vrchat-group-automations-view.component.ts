import { Component, DestroyRef, OnInit } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { VRChatService } from '../../../../services/vrchat-api/vrchat.service';
import { vshrink } from '../../../../utils/animations';
import { AutomationConfigService } from '../../../../services/automation-config.service';
import {
  AUTOMATION_CONFIGS_DEFAULT,
  VRChatGroupAutomationsConfig,
} from '../../../../models/automations';
import { SelectBoxItem } from '../../../../components/select-box/select-box.component';
import type { LimitedUserGroups } from 'vrchat/dist';
import { combineLatest } from 'rxjs';
import { BehaviorSubject } from 'rxjs';
import { error } from '@tauri-apps/plugin-log';

// Define a custom type for our group ID values
type GroupSelectType = string | 'DONT_CHANGE' | 'CLEAR_GROUP';

@Component({
  selector: 'app-vrchat-group-automations-view',
  templateUrl: './vrchat-group-automations-view.component.html',
  styleUrls: ['./vrchat-group-automations-view.component.scss'],
  animations: [vshrink()],
  standalone: false,
})
export class VRChatGroupAutomationsViewComponent implements OnInit {
  private groups: BehaviorSubject<LimitedUserGroups[]> = new BehaviorSubject<LimitedUserGroups[]>(
    []
  );
  protected loggedIn = false;

  config: VRChatGroupAutomationsConfig = structuredClone(
    AUTOMATION_CONFIGS_DEFAULT.VRCHAT_GROUP_AUTOMATIONS
  );

  groupOptions: SelectBoxItem<GroupSelectType>[] = [
    {
      id: 'DONT_CHANGE',
      label: 'vrchatGroupAutomations.options.dontChange',
      htmlPrefix: '<i class="material-symbols-outlined">chevron_right</i>',
    },
    {
      id: 'CLEAR_GROUP',
      label: 'vrchatGroupAutomations.options.clearGroup',
      htmlPrefix: '<i class="material-symbols-outlined">chevron_right</i>',
    },
  ];
  selectedOnSleepEnable: SelectBoxItem<GroupSelectType> | undefined;
  selectedOnSleepDisable: SelectBoxItem<GroupSelectType> | undefined;
  selectedOnSleepPreparation: SelectBoxItem<GroupSelectType> | undefined;

  constructor(
    private vrchat: VRChatService,
    private destroyRef: DestroyRef,
    private automationConfigService: AutomationConfigService
  ) {}

  ngOnInit(): void {
    this.vrchat.status.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((status) => {
      this.loggedIn = status === 'LOGGED_IN';
      if (this.loggedIn) this.loadGroups();
    });
    combineLatest([this.automationConfigService.configs, this.groups])
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(([configs, groups]) => {
        this.config = configs.VRCHAT_GROUP_AUTOMATIONS;
        this.groupOptions = [
          ...this.groupOptions.slice(0, 2),
          ...groups
            .filter((g) => g.privacy === 'default')
            .map((group) => ({
              id: group.groupId!,
              label: group.name!,
            })),
        ];
        this.selectedOnSleepEnable = this.groupOptions.find(
          (option) => option.id === this.config.representGroupIdOnSleepModeEnable
        );
        this.selectedOnSleepDisable = this.groupOptions.find(
          (option) => option.id === this.config.representGroupIdOnSleepModeDisable
        );
        this.selectedOnSleepPreparation = this.groupOptions.find(
          (option) => option.id === this.config.representGroupIdOnSleepPreparation
        );
      });
  }

  login() {
    this.vrchat.showLoginModal();
  }

  async loadGroups() {
    try {
      const groups = await this.vrchat.getUserGroups();
      // Sort the groups by name
      groups.sort((a, b) => a.name!.localeCompare(b.name!));
      this.groups.next(groups);
    } catch (e) {
      error('Failed to load VRChat groups: ' + e);
    }
  }

  async updateGroupOnSleepEnable(groupId: GroupSelectType) {
    await this.automationConfigService.updateAutomationConfig<VRChatGroupAutomationsConfig>(
      'VRCHAT_GROUP_AUTOMATIONS',
      {
        representGroupIdOnSleepModeEnable: groupId,
      }
    );
  }

  async updateGroupOnSleepDisable(groupId: GroupSelectType) {
    await this.automationConfigService.updateAutomationConfig<VRChatGroupAutomationsConfig>(
      'VRCHAT_GROUP_AUTOMATIONS',
      {
        representGroupIdOnSleepModeDisable: groupId,
      }
    );
  }

  async updateGroupOnSleepPreparation(groupId: GroupSelectType) {
    await this.automationConfigService.updateAutomationConfig<VRChatGroupAutomationsConfig>(
      'VRCHAT_GROUP_AUTOMATIONS',
      {
        representGroupIdOnSleepPreparation: groupId,
      }
    );
  }
}
