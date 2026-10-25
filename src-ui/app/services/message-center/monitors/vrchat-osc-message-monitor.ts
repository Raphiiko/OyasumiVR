import { inject } from '@angular/core';
import { VRChatService } from '../../vrchat-api/vrchat.service';
import { MessageMonitor } from './message-monitor';
import { OscService } from '../../osc.service';
import { combineLatest, debounceTime, distinctUntilChanged, filter, map, merge } from 'rxjs';
import { ExternalLinkService } from '../../external-link.service';
import { info, warn } from '@tauri-apps/plugin-log';

interface OscServicesState {
  issueFound: boolean;
  oscAddress: string | null;
  oscQueryAddress: string | null;
}

export class VRChatOSCMessageMonitor extends MessageMonitor {
  private externalLink = inject(ExternalLinkService);
  private vrchat = inject(VRChatService);
  private osc = inject(OscService);
  private warningShown = false;

  public override async init(): Promise<void> {
    combineLatest([
      merge(
        this.vrchat.vrchatProcessActive.pipe(
          distinctUntilChanged(),
          debounceTime(60000),
          filter(Boolean),
          map(() => true)
        ),
        this.vrchat.vrchatProcessActive.pipe(
          distinctUntilChanged(),
          filter((active) => !active),
          map(() => false)
        )
      ).pipe(distinctUntilChanged()),
      this.osc.vrchatOscAddress.pipe(distinctUntilChanged()),
      this.osc.vrchatOscQueryAddress.pipe(distinctUntilChanged()),
    ])
      .pipe(
        map(([vrcRunning, oscAddress, oscQueryAddress]): OscServicesState => ({
          issueFound: vrcRunning && (!oscAddress || !oscQueryAddress),
          oscAddress,
          oscQueryAddress,
        })),
        debounceTime(2000),
        distinctUntilChanged((previous, current) => previous.issueFound === current.issueFound)
      )
      .subscribe((state) => this.onStateChange(state));
  }

  private onStateChange(state: OscServicesState) {
    if (!state.issueFound) {
      if (this.warningShown) {
        info(
          `[VRChatOSCMessageMonitor] Hiding the OSC services warning (osc=${
            state.oscAddress ?? 'none'
          }, oscQuery=${state.oscQueryAddress ?? 'none'})`
        );
      }
      this.warningShown = false;
      this.messageCenter.removeMessage('vrcOscMissing');
      return;
    }

    warn(
      `[VRChatOSCMessageMonitor] VRChat is running, but its OSC services are missing (osc=${
        state.oscAddress ?? 'none'
      }, oscQuery=${state.oscQueryAddress ?? 'none'}), showing the warning`
    );
    this.warningShown = true;
    this.messageCenter.addMessage({
      id: 'vrcOscMissing',
      title: 'message-center.messages.vrcOscMissing.title',
      message: 'message-center.messages.vrcOscMissing.message',
      hideable: true,
      actions: [
        {
          label: 'message-center.actions.moreInfo',
          action: () => {
            this.externalLink.open(
              'https://raphii.co/oyasumivr/hidden/troubleshooting/vrchat-osc-unavailable/'
            );
          },
        },
      ],
      type: 'warning',
    });
  }
}
