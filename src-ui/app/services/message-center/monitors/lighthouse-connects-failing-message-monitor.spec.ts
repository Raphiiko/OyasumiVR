import { beforeEach, describe, expect, it, vi } from 'vitest';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { LighthouseConnectsFailingMessageMonitor } from './lighthouse-connects-failing-message-monitor';
import { MessageCenterService, MessageItem } from '../message-center.service';

vi.mock('@tauri-apps/plugin-log', () => ({
  error: vi.fn(async () => {}),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async () => () => {}),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async () => {}),
}));

describe('LighthouseConnectsFailingMessageMonitor', () => {
  let handlers: Record<string, () => void>;
  let messages: Map<string, MessageItem>;
  let messageCenter: MessageCenterService;

  beforeEach(async () => {
    handlers = {};
    messages = new Map();
    vi.mocked(listen).mockImplementation(async (event, handler) => {
      handlers[event] = handler as () => void;
      return () => {};
    });
    vi.mocked(invoke).mockReset().mockResolvedValue(undefined);
    messageCenter = {
      addMessage: (message: MessageItem) => messages.set(message.id, message),
      removeMessage: (id: string) => messages.delete(id),
    } as unknown as MessageCenterService;
    await new LighthouseConnectsFailingMessageMonitor(messageCenter).init();
  });

  async function clickRestart() {
    const action = messages.get('lighthouseConnectsFailing')!.actions![0];
    await action.action();
  }

  it('dismisses the message and keeps it away after a successful restart', async () => {
    handlers['LIGHTHOUSE_CONNECTS_FAILING']();

    await clickRestart();
    expect(messages.size).toBe(0);

    handlers['LIGHTHOUSE_CONNECTS_RECOVERED']();
    handlers['LIGHTHOUSE_CONNECTS_FAILING']();
    expect(messages.size).toBe(0);
  });

  it('shows the restart failure after a failed restart', async () => {
    vi.mocked(invoke).mockRejectedValue('radio access was refused');
    handlers['LIGHTHOUSE_CONNECTS_FAILING']();

    await clickRestart();
    expect(messages.get('lighthouseConnectsFailing')?.message).toBe(
      'message-center.messages.lighthouseConnectsFailing.restartFailed'
    );

    handlers['LIGHTHOUSE_CONNECTS_FAILING']();
    expect(messages.size).toBe(1);
  });
});
