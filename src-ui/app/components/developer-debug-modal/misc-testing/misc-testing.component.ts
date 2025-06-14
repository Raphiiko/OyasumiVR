import { Component, Input } from '@angular/core';
import { BaseModalComponent } from '../../base-modal/base-modal.component';
import { AppSettingsService } from 'src-ui/app/services/app-settings.service';
import { MessageCenterService } from 'src-ui/app/services/message-center/message-center.service';
import { TranslateService } from '@ngx-translate/core';
import { openUrl } from '@tauri-apps/plugin-opener';

@Component({
  selector: 'app-misc-testing',
  templateUrl: './misc-testing.component.html',
  styleUrls: ['./misc-testing.component.scss'],
  standalone: false,
})
export class MiscTestingComponent {
  @Input() modal?: BaseModalComponent<any, any>;

  constructor(
    private appSettings: AppSettingsService,
    private messageCenter: MessageCenterService,
    private translate: TranslateService
  ) {}

  clearLighthouseV1Ids() {
    this.appSettings.updateSettings({
      v1LighthouseIdentifiers: {},
    });
  }

  addTestMessage() {
    const senderUsername = Math.random().toString(36).substring(2, 15);
    this.messageCenter.addMessage({
      id: `vrcInviteRequestFailedWorldUnknown_${senderUsername}`,
      title: 'message-center.messages.vrcInviteRequestFailedWorldUnknown.title',
      message: {
        string: 'message-center.messages.vrcInviteRequestFailedWorldUnknown.message',
        values: {
          senderUsername:
            senderUsername ??
            this.translate.instant(
              'message-center.messages.vrcInviteRequestFailedWorldUnknown.unknownFriend'
            ),
        },
      },
      closeable: true,
      actions: [
        {
          label: 'message-center.actions.moreInfo',
          action: () => {
            openUrl(
              'https://raphii.co/oyasumivr/hidden/troubleshooting/vrchat-invite-request-auto-accept-world-unknown/'
            );
          },
        },
      ],
      type: 'warning',
    });
  }
}
