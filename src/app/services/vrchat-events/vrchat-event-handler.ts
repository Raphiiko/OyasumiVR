import { NotificationHandler } from './handlers/notification-handler';

export interface VRChatEventHandler {
  type: string;
  handle: (content: string) => void;
}

const handlers: VRChatEventHandler[] = [
  new NotificationHandler(),
];

export const handleVRChatEvent = (type: string, content: string) => {
  const handler = handlers.find((handler) => handler.type === type);
  if (!handler) return;
  handler.handle(content);
};
