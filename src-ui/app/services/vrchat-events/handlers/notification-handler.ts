import { VRChatEventHandler } from '../vrchat-event-handler';
import { VRChatService } from '../../vrchat.service';
import type { Notification } from 'vrchat/dist';

export class NotificationHandler implements VRChatEventHandler {
  type = 'notification';

  constructor(private vrchat: VRChatService) {}

  async handle(contentString: string) {
    // Parse the message content
    const notification: Notification = JSON.parse(contentString);
    // Pass it on to the VRChat service for further handling
    await this.vrchat.handleNotification(notification);
  }
}
