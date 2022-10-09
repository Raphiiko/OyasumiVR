import { VRChatEventHandler } from '../vrchat-event-handler';

export class NotificationHandler implements VRChatEventHandler {
  type = 'notification';
  handle(content: string) {}
}
