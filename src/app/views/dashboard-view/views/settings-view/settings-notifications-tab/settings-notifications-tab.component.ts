import { Component } from '@angular/core';
import { SettingsTabComponent } from '../settings-tab/settings-tab.component';
import { AppSettingsService } from '../../../../../services/app-settings.service';
import { hshrink, vshrink } from '../../../../../utils/animations';
import { NotificationService } from '../../../../../services/notification.service';

@Component({
  selector: 'app-settings-notifications-tab',
  templateUrl: './settings-notifications-tab.component.html',
  styleUrls: ['./settings-notifications-tab.component.scss'],
  animations: [vshrink(), hshrink()],
})
export class SettingsNotificationsTabComponent extends SettingsTabComponent {
  constructor(settingsService: AppSettingsService, protected notifications: NotificationService) {
    super(settingsService);
  }

  override async ngOnInit() {
    super.ngOnInit();
  }
}
