import { inject } from '@angular/core';
import { ElevatedSidecarService } from '../../elevated-sidecar.service';
import { MessageMonitor } from './message-monitor';
import { appLogDir } from '@tauri-apps/api/path';
import { invoke } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';

export class ElevatedFeaturesMessageMonitor extends MessageMonitor {
  private elevatedFeatures = inject(ElevatedSidecarService);

  public override init(): void {
    this.elevatedFeatures.failure.subscribe((failure) => {
      if (!failure) {
        this.messageCenter.removeMessage('elevatedFeaturesFailure');
        return;
      }
      this.messageCenter.addMessage({
        id: 'elevatedFeaturesFailure',
        title: `message-center.messages.elevatedFeaturesFailure.${failure.operation}.title`,
        message: `settings.general.adminPrivileges.errors.${failure.result.result}`,
        type: 'error',
        actions: [
          {
            label: 'message-center.messages.elevatedFeaturesFailure.actions.retry',
            action: () =>
              failure.operation === 'enable'
                ? this.elevatedFeatures.enable()
                : this.elevatedFeatures.disable(),
          },
          {
            label: 'message-center.actions.openLogFolder',
            action: async () => {
              const path = (await appLogDir()) + '\\OyasumiVR_Core.log';
              await invoke('show_in_folder', { path });
            },
          },
          {
            label: 'message-center.actions.supportDiscord',
            action: () => openUrl('https://discord.gg/7MqdPJhYxC'),
          },
        ],
      });
    });
  }
}
