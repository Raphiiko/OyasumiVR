import { inject } from '@angular/core';
import { MessageMonitor } from './message-monitor';
import { filter, take } from 'rxjs';
import { LighthouseService } from '../../lighthouse.service';

export class ManyLighthousesDetectedMessageMonitor extends MessageMonitor {
  private lighthouse = inject(LighthouseService);

  public override async init(): Promise<void> {
    // Show message when more than 4 lighthouses are detected
    this.lighthouse.devices
      .pipe(
        filter((d) => d.length > 4),
        take(1)
      )
      .subscribe(() => {
        this.messageCenter.addMessage({
          id: 'manyLighthousesDetected',
          title: 'message-center.messages.manyLighthousesDetected.title',
          message: 'message-center.messages.manyLighthousesDetected.message',
          hideable: true,
          type: 'info',
          actions: [],
        });
      });
  }
}
