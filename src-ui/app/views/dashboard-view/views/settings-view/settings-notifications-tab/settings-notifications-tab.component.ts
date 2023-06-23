import { Component, OnInit } from '@angular/core';
import { SettingsTabComponent } from '../settings-tab/settings-tab.component';
import { AppSettingsService } from '../../../../../services/app-settings.service';
import { hshrink, vshrink } from '../../../../../utils/animations';
import { NotificationService } from '../../../../../services/notification.service';
import { SelectBoxItem } from 'src-ui/app/components/select-box/select-box.component';
import {
  NotificationProvider,
  NotificationType,
  NotificationTypes,
} from 'src-ui/app/models/settings';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

@Component({
  selector: 'app-settings-notifications-tab',
  templateUrl: './settings-notifications-tab.component.html',
  styleUrls: ['./settings-notifications-tab.component.scss'],
  animations: [vshrink(), hshrink()],
})
export class SettingsNotificationsTabComponent extends SettingsTabComponent implements OnInit {
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
      id: 'DESKTOP',
      label: 'Windows',
    },
  ];
  protected providerOption: SelectBoxItem = this.providerOptions[0];
  private notificationsEnabled: NotificationType[] = [];

  constructor(settingsService: AppSettingsService, protected notifications: NotificationService) {
    super(settingsService);
  }

  override async ngOnInit() {
    super.ngOnInit();
    this.settingsService.settings
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((settings) => {
        this.providerOption =
          this.providerOptions.find((o) => o.id === settings.notificationProvider) ??
          this.providerOptions[0];
        this.notificationsEnabled = [...settings.notificationsEnabled.types];
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
}
