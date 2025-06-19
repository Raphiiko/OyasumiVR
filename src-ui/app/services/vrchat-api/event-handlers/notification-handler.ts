import { VRChatEventHandler } from '../vrchat-socket';
import type { Notification } from 'vrchat/dist';

export class NotificationHandler implements VRChatEventHandler {
  type = 'notification';

  constructor(private onVRChatNotification: (notification: Notification) => Promise<void>) {}

  async handle(contentString: string) {
    // Parse the message content
    const notification: Notification = JSON.parse(contentString);
    // Pass it on to the VRChat service for further handling
    await this.onVRChatNotification(notification);
  }
}
