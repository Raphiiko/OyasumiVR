import { UserUpdateHandler } from './handlers/user-update-handler';
import { VRChatService } from '../vrchat.service';
import { isDevMode } from '@angular/core';
import { NotificationHandler } from './handlers/notification-handler';

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
    if (!handler) {
      // if (isDevMode())
      //   console.log('Unhandled VRChat Event', {
      //     type,
      //     content,
      //     contentParsed: (() => {
      //       try {
      //         return JSON.parse(content);
      //       } catch (e) {
      //         return null;
      //       }
      //     })(),
      //   });
      return;
    }
    handler.handle(content);
  };
}
