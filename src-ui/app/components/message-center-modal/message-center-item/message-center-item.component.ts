import { Component, computed, input, Signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import {
  MessageCenterService,
  MessageItem,
} from 'src-ui/app/services/message-center/message-center.service';

@Component({
  selector: 'app-message-center-item',
  standalone: false,
  templateUrl: './message-center-item.component.html',
  styleUrl: './message-center-item.component.scss',
})
export class MessageCenterItemComponent {
  private readonly hiddenMessageIds: Signal<string[] | undefined>;
  public readonly message = input.required<MessageItem>();
  protected readonly actions = computed(() => {
    const message = this.message();
    const hiddenMessageIds = this.hiddenMessageIds();
    const actions = [...(message.actions ?? [])];
    if (message.hideable) {
      const isHidden = hiddenMessageIds?.includes(message.id) ?? false;
      if (isHidden) {
        actions.push({
          label: 'message-center.actions.unhide',
          action: () => {
            this.messageCenter.unhideMessageId(message.id);
          },
        });
      } else {
        actions.push({
          label: 'message-center.actions.hide',
          action: () => {
            this.messageCenter.hideMessageId(message.id);
          },
        });
      }
    }
    if (message.closeable) {
      actions.push({
        label: 'shared.modals.close',
        action: () => {
          this.messageCenter.removeMessage(message.id);
        },
      });
    }
    return actions;
  });

  protected getIcon(): string {
    switch (this.message().type) {
      case 'info':
        return 'info';
      case 'warning':
        return 'warning';
      case 'error':
        return 'error';
      default:
        return 'info';
    }
  }

  constructor(private messageCenter: MessageCenterService) {
    this.hiddenMessageIds = toSignal(messageCenter.hiddenMessageIds);
  }
}
