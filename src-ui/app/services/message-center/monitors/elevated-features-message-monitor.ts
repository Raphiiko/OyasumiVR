import { inject } from '@angular/core';
import { ElevatedSidecarService } from '../../elevated-sidecar.service';
import { MessageMonitor } from './message-monitor';
import { ExternalLinkService } from '../../external-link.service';
import { ShowInFolderService } from '../../show-in-folder.service';

export class ElevatedFeaturesMessageMonitor extends MessageMonitor {
  private externalLink = inject(ExternalLinkService);
  private elevatedFeatures = inject(ElevatedSidecarService);
  private showInFolder = inject(ShowInFolderService);

  public override init(): void {
    this.elevatedFeatures.failure.subscribe((failure) => {
      if (!failure) {
        this.messageCenter.removeMessage('elevatedFeaturesFailure');
        return;
      }
      // only the startup enable publishes enable failures, so a declined prompt here came from it
      if (failure.operation === 'enable' && failure.result.result === 'promptDeclined') {
        this.showStartupPromptDeclined();
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
            action: () => this.showInFolder.showLogFile(),
          },
          {
            label: 'message-center.actions.supportDiscord',
            action: () => this.externalLink.open('https://discord.gg/7MqdPJhYxC'),
          },
        ],
      });
    });
  }

  private showStartupPromptDeclined() {
    const prefix = 'message-center.messages.elevatedFeaturesFailure.startupPromptNotApproved';
    this.messageCenter.addMessage({
      id: 'elevatedFeaturesFailure',
      title: `${prefix}.title`,
      message: `${prefix}.message`,
      type: 'warning',
      actions: [
        { label: `${prefix}.actions.enable`, action: () => this.elevatedFeatures.enable() },
      ],
    });
  }
}
