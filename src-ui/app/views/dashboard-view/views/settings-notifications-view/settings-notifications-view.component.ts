import { Component, DestroyRef, OnInit } from '@angular/core';
import { SelectBoxItem } from 'src-ui/app/components/select-box/select-box.component';
import {
  APP_SETTINGS_DEFAULT,
  NotificationProvider,
  NotificationType,
  NotificationTypes,
} from 'src-ui/app/models/settings';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { vshrink } from 'src-ui/app/utils/animations';
import { hshrink } from '../../../../utils/animations';
import { NotificationService } from 'src-ui/app/services/notification.service';
import { AppSettingsService } from 'src-ui/app/services/app-settings.service';

@Component({
  selector: 'app-settings-notifications-view',
  templateUrl: './settings-notifications-view.component.html',
  styleUrls: ['./settings-notifications-view.component.scss'],
  animations: [vshrink(), hshrink()],
})
export class SettingsNotificationsViewComponent implements OnInit {
  protected notificationTypes: NotificationType[] = [...NotificationTypes] as NotificationType[];
  protected providerOptions: SelectBoxItem[] = [
    {
      id: 'OYASUMIVR',
      label: 'OyasumiVR',
    },
    {
      id: 'XSOVERLAY',
      label: 'XSOverlay',
    },
    {
      id: 'OVRTOOLKIT',
      label: 'OVRToolkit',
    },
    {
      id: 'DESKTOP',
      label: 'Windows',
    },
  ];
  protected providerOption: SelectBoxItem = this.providerOptions[0];
  private notificationsEnabled: NotificationType[] = [];
  protected generalNotificationVolume = APP_SETTINGS_DEFAULT.generalNotificationVolume;
  protected playingTestSound = false;
  private playingTestSoundTimeout: any;

  constructor(
    protected notifications: NotificationService,
    private destroyRef: DestroyRef,
    private settingsService: AppSettingsService
  ) {}

  async ngOnInit() {
    this.settingsService.settings
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((settings) => {
        this.providerOption =
          this.providerOptions.find((o) => o.id === settings.notificationProvider) ??
          this.providerOptions[0];
        this.notificationsEnabled = [...settings.notificationsEnabled.types];
        this.generalNotificationVolume = settings.generalNotificationVolume;
      });
  }

  protected onChangeProviderOption(option: SelectBoxItem | undefined) {
    option = option ?? this.providerOptions[0];
    this.providerOption = option;
    this.notifications.setProvider(option.id as NotificationProvider);
  }

  protected isNotificationTypeChecked(type: NotificationType): boolean {
    return this.notificationsEnabled.includes(type);
  }

  protected toggleNotificationType(type: NotificationType) {
    if (this.isNotificationTypeChecked(type)) {
      this.notificationsEnabled = this.notificationsEnabled.filter((t) => t !== type);
    } else {
      this.notificationsEnabled.push(type);
    }
    this.settingsService.updateSettings({
      notificationsEnabled: { types: [...this.notificationsEnabled] },
    });
  }

  protected setGeneralNotificationVolume(volume: number) {
    this.settingsService.updateSettings({
      generalNotificationVolume: volume,
    });
  }

  protected async testSound() {
    await this.notifications.playSound('material_hero_simple-celebration-01');
    this.playingTestSound = true;
    if (this.playingTestSoundTimeout) clearTimeout(this.playingTestSoundTimeout);
    this.playingTestSoundTimeout = setTimeout(() => {
      this.playingTestSound = false;
      this.playingTestSoundTimeout = undefined;
    }, 1000);
  }
}
