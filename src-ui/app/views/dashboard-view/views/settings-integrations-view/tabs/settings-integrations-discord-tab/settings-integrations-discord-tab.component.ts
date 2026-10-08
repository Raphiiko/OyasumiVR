import { Component, DestroyRef, OnInit, ChangeDetectionStrategy } from '@angular/core';
import { SelectBoxItem } from 'src-ui/app/components/select-box/select-box.component';
import { AppSettingsService } from 'src-ui/app/services/app-settings.service';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { APP_SETTINGS_DEFAULT, AppSettings, DiscordActivityMode } from 'src-ui/app/models/settings';

@Component({
  selector: 'app-settings-integrations-discord-tab',
  templateUrl: './settings-integrations-discord-tab.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  standalone: false,
})
export class SettingsIntegrationsDiscordTabComponent implements OnInit {
  discordActivityModeOptions: SelectBoxItem[] = [
    {
      id: 'ENABLED',
      label: 'settings.integrations.discord.activityMode.options.ENABLED',
    },
    {
      id: 'ONLY_ASLEEP',
      label: 'settings.integrations.discord.activityMode.options.ONLY_ASLEEP',
    },
    {
      id: 'DISABLED',
      label: 'settings.integrations.discord.activityMode.options.DISABLED',
    },
  ];
  discordActivityModeOption: SelectBoxItem | undefined;
  appSettings: AppSettings = structuredClone(APP_SETTINGS_DEFAULT);

  constructor(
    private settingsService: AppSettingsService,
    private destroyRef: DestroyRef
  ) {}

  ngOnInit(): void {
    this.settingsService.settings
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((settings) => {
        this.appSettings = settings;
        this.discordActivityModeOption = this.discordActivityModeOptions.find(
          (o) => o.id === settings.discordActivityMode
        );
      });
  }

  protected setDiscordActivityOnlyWhenVRChatIsRunning(enabled: boolean) {
    this.settingsService.updateSettings({ discordActivityOnlyWhileVRChatIsRunning: enabled });
  }

  protected onChangeDiscordActivityMode(option: SelectBoxItem | undefined) {
    if (!option) return;
    this.settingsService.updateSettings({
      discordActivityMode: option!.id as DiscordActivityMode,
    });
  }
}
