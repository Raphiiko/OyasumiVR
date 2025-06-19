import { Component, DestroyRef, OnInit } from '@angular/core';
import { SelectBoxItem } from '../../../../components/select-box/select-box.component';
import {
  AUTOMATION_CONFIGS_DEFAULT,
  JoinNotificationsAutomationsConfig,
  JoinNotificationsMode,
  SoundEffectConfig,
} from '../../../../models/automations';

import { AutomationConfigService } from '../../../../services/automation-config.service';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';
import { NotificationService } from '../../../../services/notification.service';
import { hshrink } from 'src-ui/app/utils/animations';
import { VRChatService } from '../../../../services/vrchat-api/vrchat.service';

@Component({
  selector: 'app-join-notifications-view',
  templateUrl: './join-notifications-view.component.html',
  styleUrls: ['./join-notifications-view.component.scss'],
  animations: [hshrink()],
  standalone: false,
})
export class JoinNotificationsViewComponent implements OnInit {
  notificationOptions: SelectBoxItem[] = [
    {
      id: 'EVERYONE',
      label: 'join-notifications.modeOptions.EVERYONE',
    },
    {
      id: 'FRIEND',
      label: 'join-notifications.modeOptions.FRIEND',
    },
    {
      id: 'WHITELIST',
      label: 'join-notifications.modeOptions.WHITELIST',
    },
    {
      id: 'BLACKLIST',
      label: 'join-notifications.modeOptions.BLACKLIST',
    },
    {
      id: 'DISABLED',
      label: 'join-notifications.modeOptions.DISABLED',
    },
  ];
  joinNotificationOption: SelectBoxItem | undefined;
  leaveNotificationOption: SelectBoxItem | undefined;
  joinSoundOption: SelectBoxItem | undefined;
  leaveSoundOption: SelectBoxItem | undefined;
  config: JoinNotificationsAutomationsConfig = structuredClone(
    AUTOMATION_CONFIGS_DEFAULT.JOIN_NOTIFICATIONS
  );

  constructor(
    private automationConfigService: AutomationConfigService,
    private destroyRef: DestroyRef,
    private notifications: NotificationService,
    protected vrchat: VRChatService
  ) {}

  ngOnInit() {
    this.automationConfigService.configs
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        map((config) => config.JOIN_NOTIFICATIONS)
      )
      .subscribe((config) => {
        this.config = config;
        this.joinNotificationOption = this.notificationOptions.find(
          (option) => option.id === config.joinNotification
        );
        this.joinSoundOption = this.notificationOptions.find(
          (option) => option.id === config.joinSoundMode
        );
        this.leaveNotificationOption = this.notificationOptions.find(
          (option) => option.id === config.leaveNotification
        );
        this.leaveSoundOption = this.notificationOptions.find(
          (option) => option.id === config.leaveSoundMode
        );
      });
  }

  async updateConfig(config: Partial<JoinNotificationsAutomationsConfig>) {
    await this.automationConfigService.updateAutomationConfig<JoinNotificationsAutomationsConfig>(
      'JOIN_NOTIFICATIONS',
      config
    );
  }

  async setJoinNotificationModeOption(mode?: JoinNotificationsMode) {
    if (!mode) return;
    await this.updateConfig({
      joinNotification: mode,
    });
  }

  async setLeaveNotificationModeOption(mode?: JoinNotificationsMode) {
    if (!mode) return;
    await this.updateConfig({
      leaveNotification: mode,
    });
  }

  async setJoinSoundModeOption(mode?: JoinNotificationsMode) {
    if (!mode) return;
    await this.updateConfig({
      joinSoundMode: mode,
    });
  }

  async setLeaveSoundModeOption(mode?: JoinNotificationsMode) {
    if (!mode) return;
    await this.updateConfig({
      leaveSoundMode: mode,
    });
  }

  async toggleOnlyDuringSleepMode() {
    await this.updateConfig({
      onlyDuringSleepMode: !this.config.onlyDuringSleepMode,
    });
  }

  async toggleOnlyWhenPreviouslyAlone() {
    await this.updateConfig({
      onlyWhenPreviouslyAlone: !this.config.onlyWhenPreviouslyAlone,
    });
  }
  async toggleOnlyWhenLeftAlone() {
    await this.updateConfig({
      onlyWhenLeftAlone: !this.config.onlyWhenLeftAlone,
    });
  }

  async updatePlayerIds(playerIds: string[]) {
    await this.updateConfig({
      playerIds,
    });
  }

  asJoinNotificationsMode(id: string | undefined) {
    if (!id) return undefined;
    return id as JoinNotificationsMode;
  }

  updateJoinSound(soundConfig: SoundEffectConfig): void {
    this.config.joinSound = soundConfig;
    this.automationConfigService.updateAutomationConfig<JoinNotificationsAutomationsConfig>(
      'JOIN_NOTIFICATIONS',
      this.config
    );
  }

  updateLeaveSound(soundConfig: SoundEffectConfig): void {
    this.config.leaveSound = soundConfig;
    this.automationConfigService.updateAutomationConfig<JoinNotificationsAutomationsConfig>(
      'JOIN_NOTIFICATIONS',
      this.config
    );
  }
}
