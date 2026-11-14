import { Injector, runInInjectionContext } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VRChatService } from '../../vrchat-api/vrchat.service';
import { MessageCenterService, MessageItem } from '../message-center.service';
import { VRChatWebsocketConnectionMonitor } from './vrchat-websocket-connection-monitor';

vi.mock('../../vrchat-api/vrchat.service', () => ({ VRChatService: class {} }));

describe('VRChatWebsocketConnectionMonitor', () => {
  let websocketStatus: BehaviorSubject<string>;
  let messages: Map<string, MessageItem>;

  beforeEach(async () => {
    vi.useFakeTimers();
    websocketStatus = new BehaviorSubject('OPENING');
    messages = new Map();
    const messageCenter = {
      addMessage: (message: MessageItem) => messages.set(message.id, message),
      removeMessage: (id: string) => messages.delete(id),
    } as unknown as MessageCenterService;
    const vrchat = {
      status: new BehaviorSubject('LOGGED_IN'),
      websocketStatus,
    } as unknown as VRChatService;
    const injector = Injector.create({ providers: [{ provide: VRChatService, useValue: vrchat }] });
    const monitor = runInInjectionContext(
      injector,
      () => new VRChatWebsocketConnectionMonitor(messageCenter)
    );
    await monitor.init();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function rejectedConnection() {
    websocketStatus.next('OPENING');
    websocketStatus.next('OPEN');
    await vi.advanceTimersByTimeAsync(500);
    websocketStatus.next('CLOSED');
    await vi.advanceTimersByTimeAsync(9_500);
  }

  it('warns when every connection closes within a second of opening', async () => {
    for (let attempt = 0; attempt < 7; attempt++) await rejectedConnection();
    await vi.advanceTimersByTimeAsync(1_000);

    expect(messages.has('vrcWebsocketDisconnected')).toBe(true);
  });

  it('removes the warning once a connection stays open', async () => {
    for (let attempt = 0; attempt < 7; attempt++) await rejectedConnection();
    await vi.advanceTimersByTimeAsync(1_000);

    websocketStatus.next('OPEN');
    await vi.advanceTimersByTimeAsync(10_000);

    expect(messages.has('vrcWebsocketDisconnected')).toBe(false);
  });
});
