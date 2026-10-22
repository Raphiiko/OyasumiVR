import { DestroyRef, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MessageCenterService } from '../message-center.service';
import { MessageMonitor } from './message-monitor';
import { PulsoidService } from '../../integrations/pulsoid.service';

const MESSAGE_ID = 'pulsoidBatteryLevelScopeMissing';

export class PulsoidBatteryLevelScopeMessageMonitor extends MessageMonitor {
  private destroyRef = inject(DestroyRef);
  private pulsoid = inject(PulsoidService);

  constructor(messageCenter: MessageCenterService) {
    super(messageCenter);
  }

  public init(): void {
    this.pulsoid.batteryLevelScopeMissing
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((missing) => this.onBatteryLevelScopeMissing(missing));
  }

  private onBatteryLevelScopeMissing(missing: boolean) {
    if (!missing) {
      this.messageCenter.removeMessage(MESSAGE_ID);
      return;
    }
    this.messageCenter.addMessage({
      id: MESSAGE_ID,
      type: 'info',
      title: 'message-center.messages.pulsoidBatteryLevelScopeMissing.title',
      message: 'message-center.messages.pulsoidBatteryLevelScopeMissing.message',
      hideable: true,
      actions: [
        {
          label: 'message-center.messages.pulsoidBatteryLevelScopeMissing.actions.reconnect',
          action: () => this.pulsoid.login(),
        },
      ],
    });
  }
}
