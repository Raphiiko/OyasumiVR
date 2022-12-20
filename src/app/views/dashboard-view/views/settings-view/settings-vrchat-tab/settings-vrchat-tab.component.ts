import { Component } from '@angular/core';
import { SettingsTabComponent } from '../settings-tab/settings-tab.component';
import { AppSettingsService } from '../../../../../services/app-settings.service';
import { vshrink } from '../../../../../utils/animations';
import { VRChatService, VRChatServiceStatus } from '../../../../../services/vrchat.service';
import { takeUntil } from 'rxjs';
import { CurrentUser as VRChatUser } from 'vrchat/dist';
import { SimpleModalService } from 'ngx-simple-modal';

@Component({
  selector: 'app-settings-vrchat-tab',
  templateUrl: './settings-vrchat-tab.component.html',
  styleUrls: ['./settings-vrchat-tab.component.scss'],
  animations: [vshrink()],
})
export class SettingsVRChatTabComponent extends SettingsTabComponent {
  vrchatStatus: VRChatServiceStatus = 'PRE_INIT';
  currentUser: VRChatUser | null = null;

  constructor(
    settingsService: AppSettingsService,
    private vrchat: VRChatService,
    private modalService: SimpleModalService
  ) {
    super(settingsService);
  }

  override async ngOnInit() {
    super.ngOnInit();
    this.vrchat.status.pipe(takeUntil(this.destroy$)).subscribe((status) => {
      this.vrchatStatus = status;
    });
    this.vrchat.user.pipe(takeUntil(this.destroy$)).subscribe((user) => {
      this.currentUser = user;
    });
  }

  login() {
    this.vrchat.showLoginModal();
  }

  async logout() {
    await this.vrchat.logout();
  }
}
