import { describe, expect, it, vi } from 'vitest';
import { VRChatSocket, VRChatEventHandler } from './vrchat-socket';

describe('VRChatSocket', () => {
  it('ignores messages from a replaced socket', async () => {
    const currentSocket = {} as WebSocket;
    const staleSocket = {} as WebSocket;
    const handle = vi.fn();
    const socket = new VRChatSocket({} as never, {} as never, {} as never);
    const internals = socket as unknown as {
      socket: WebSocket;
      handlers: VRChatEventHandler[];
      onSocketEvent(socket: WebSocket, event: 'MESSAGE', message: MessageEvent): Promise<void>;
    };
    internals.socket = currentSocket;
    internals.handlers = [{ type: 'group-member-updated', handle }];

    await internals.onSocketEvent(
      staleSocket,
      'MESSAGE',
      new MessageEvent('message', {
        data: JSON.stringify({ type: 'group-member-updated', content: '{}' }),
      })
    );

    expect(handle).not.toHaveBeenCalled();
  });
});
