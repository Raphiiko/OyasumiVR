import { Component, OnInit } from '@angular/core';
import { SettingsTabComponent } from '../settings-tab/settings-tab.component';
import { AppSettingsService } from '../../../../../services/app-settings.service';
import { noop } from '../../../../../utils/animations';

@Component({
  selector: 'app-settings-vrchat-tab',
  templateUrl: './settings-vrchat-tab.component.html',
  styleUrls: ['./settings-vrchat-tab.component.scss'],
  animations: [],
})
export class SettingsVRChatTabComponent extends SettingsTabComponent {
  constructor(settingsService: AppSettingsService) {
    super(settingsService);
  }

  override async ngOnInit() {
    super.ngOnInit();
  }
}
