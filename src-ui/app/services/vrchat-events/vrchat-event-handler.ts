import { UserUpdateHandler } from './handlers/user-update-handler';
import { VRChatService } from '../vrchat.service';
import { NotificationHandler } from './handlers/notification-handler';
import { info } from '@tauri-apps/plugin-log';

export interface VRChatEventHandler {
  type: string;
  handle: (content: string) => void;
}

export class VRChatEventHandlerManager {
  handlers: VRChatEventHandler[] = [];

  constructor(vrchat: VRChatService) {
    this.handlers = [new UserUpdateHandler(vrchat), new NotificationHandler(vrchat)];
  }

  handle = (type: string, content: string) => {
    const handler = this.handlers.find((handler) => handler.type === type);
    if (!handler) return;
    info(`[VRChat] Received event: ${type}`);
    handler.handle(content);
  };
}
