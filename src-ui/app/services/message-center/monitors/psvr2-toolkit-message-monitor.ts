import { inject } from '@angular/core';
import { MessageMonitor } from './message-monitor';
import { combineLatest, distinctUntilChanged, map } from 'rxjs';
import { ExternalLinkService } from '../../external-link.service';
import { OpenVRService } from '../../openvr.service';

const MESSAGE_ID = 'psvr2ToolkitMissing';

export class PSVR2ToolkitMessageMonitor extends MessageMonitor {
  private externalLink = inject(ExternalLinkService);
  private openvr = inject(OpenVRService);

  public override init(): void {
    combineLatest([this.openvr.status, this.openvr.devices])
      .pipe(
        map(([status, devices]) => {
          const hmd = devices.find((d) => d.index === 0 && d.class === 'HMD');
          // Sony's own driver reports no analog gain support, PSVR2Toolkit adds it
          return (
            status === 'INITIALIZED' &&
            hmd?.manufacturerName === 'SIE' &&
            hmd.modelNumber === 'PS VR2' &&
            hmd.displaySupportsAnalogGain !== true
          );
        }),
        distinctUntilChanged()
      )
      .subscribe((toolkitMissing) => this.update(toolkitMissing));
  }

  private update(toolkitMissing: boolean) {
    if (!toolkitMissing) {
      this.messageCenter.removeMessage(MESSAGE_ID);
      return;
    }
    this.messageCenter.addMessage({
      id: MESSAGE_ID,
      title: `message-center.messages.${MESSAGE_ID}.title`,
      message: `message-center.messages.${MESSAGE_ID}.message`,
      hideable: true,
      type: 'info',
      actions: [
        {
          label: 'message-center.actions.moreInfo',
          action: () => this.externalLink.open('https://github.com/BnuuySolutions/PSVR2Toolkit'),
        },
      ],
    });
  }
}
