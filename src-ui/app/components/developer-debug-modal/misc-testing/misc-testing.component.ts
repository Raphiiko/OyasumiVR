import { Component, Input } from '@angular/core';
import { BaseModalComponent } from '../../base-modal/base-modal.component';
import { AppSettingsService } from 'src-ui/app/services/app-settings.service';
import { MessageCenterService } from 'src-ui/app/services/message-center/message-center.service';
import { TranslateService } from '@ngx-translate/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import { DeviceSelection } from 'src-ui/app/models/device-manager';
import { OscScript } from 'src-ui/app/models/osc-script';
import { migrateOscScript } from 'src-ui/app/migrations/osc-script.migrations';
import { isEqual } from 'lodash';

@Component({
  selector: 'app-misc-testing',
  templateUrl: './misc-testing.component.html',
  styleUrls: ['./misc-testing.component.scss'],
  standalone: false,
})
export class MiscTestingComponent {
  @Input() modal?: BaseModalComponent<any, any>;

  deviceSelection: DeviceSelection = { devices: [], types: [], tagIds: [] };

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

  testOscScriptMigration() {
    const scriptBefore: any = {
      version: 1,
      commands: [
        {
          type: 'SLEEP',
          duration: 1000,
        },
        {
          type: 'COMMAND',
          address: '/test',
          parameters: [{ type: 'INT', value: '1' }],
        },
        {
          type: 'COMMAND',
          address: '/test',
          parameters: [
            { type: 'STRING', value: '1' },
            { type: 'FLOAT', value: '1.0' },
            { type: 'BOOLEAN', value: 'true' },
          ],
        },
      ],
    };

    const scriptAfter: OscScript = {
      version: 3,
      commands: [
        {
          type: 'SLEEP',
          duration: 1000,
        },
        {
          type: 'COMMAND',
          address: '/test',
          parameters: [{ type: 'Int', value: '1' }],
        },
        {
          type: 'COMMAND',
          address: '/test',
          parameters: [
            { type: 'String', value: '1' },
            { type: 'Float', value: '1.0' },
            { type: 'Boolean', value: 'true' },
          ],
        },
      ],
    };

    const scriptMigrated = migrateOscScript(scriptBefore);

    console.log({
      scriptBefore,
      scriptAfter,
      scriptMigrated,
      success: isEqual(scriptAfter, scriptMigrated),
    });
  }
}
