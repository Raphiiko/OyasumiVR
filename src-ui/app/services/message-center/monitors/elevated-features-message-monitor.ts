import { SUPPORT_DISCORD_URL } from 'src-ui/app/globals';
import { inject } from '@angular/core';
import { ElevatedSidecarService } from '../../elevated-sidecar.service';
import { MessageMonitor } from './message-monitor';
import { ExternalLinkService } from '../../external-link.service';
import { DebugReportService } from '../../debug-report.service';

export class ElevatedFeaturesMessageMonitor extends MessageMonitor {
  private externalLink = inject(ExternalLinkService);
  private elevatedFeatures = inject(ElevatedSidecarService);
  private debugReports = inject(DebugReportService);

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
        // the shared error text points at Troubleshooting, which this message's own button replaces
        message:
          failure.result.result === 'notSupported'
            ? 'settings.general.adminPrivileges.errors.notSupported'
            : `message-center.messages.elevatedFeaturesFailure.${failure.operation}.message`,
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
            label: 'message-center.actions.uploadDebugReport',
            action: () => this.debugReports.open(),
          },
          {
            label: 'message-center.actions.supportDiscord',
            action: () => this.externalLink.open(SUPPORT_DISCORD_URL),
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
