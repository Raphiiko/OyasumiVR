import { BehaviorSubject, of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VRChatApiSettings } from 'src-ui/app/models/vrchat-api-settings';
import type { VRChatAPI } from './vrchat-api';
import type { VRChatAuth } from './vrchat-auth';
import { VRChatSocket } from './vrchat-socket';

vi.mock('@tauri-apps/plugin-log', () => ({
  info: vi.fn(),
  error: vi.fn(),
}));

class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static instances: FakeWebSocket[] = [];
  readyState = FakeWebSocket.CONNECTING;
  onopen?: () => void;
  onerror?: () => void;
  onclose?: (event: Partial<CloseEvent>) => void;
  onmessage?: (event: Partial<MessageEvent>) => void;

  constructor() {
    FakeWebSocket.instances.push(this);
  }

  close() {}

  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }

  receive(data: unknown) {
    this.onmessage?.({ data: typeof data === 'string' ? data : JSON.stringify(data) });
  }

  drop() {
    this.readyState = 3;
    this.onclose?.({ code: 1006, wasClean: false, reason: '' });
  }
}

const settings = {
  profiles: [{ id: 'p', authCookie: 'token' }],
  activeProfileId: 'p',
} as unknown as VRChatApiSettings;

async function createSocket() {
  const reportError = vi.fn();
  const receivedUserUpdate = vi.fn();
  const revalidateSession = vi.fn(async () => {});
  const auth = {
    status: new BehaviorSubject('LOGGED_IN'),
    receivedUserUpdate,
    revalidateSession,
  } as unknown as VRChatAuth;
  const socket = new VRChatSocket(auth, {} as VRChatAPI, of(settings), reportError);
  const notifications: unknown[] = [];
  socket.notifications.subscribe((n) => notifications.push(n));
  socket.init();
  await vi.waitFor(() => expect(FakeWebSocket.instances.length).toBe(1));
  return { reportError, receivedUserUpdate, revalidateSession, notifications };
}

async function reconnect(count: number) {
  await vi.advanceTimersByTimeAsync(10_000);
  await vi.waitFor(() => expect(FakeWebSocket.instances.length).toBe(count));
  return FakeWebSocket.instances[count - 1];
}

describe('VRChatSocket', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeWebSocket.instances = [];
    vi.stubGlobal('WebSocket', FakeWebSocket);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('treats an error frame and the close after it as a rejection, not a failure', async () => {
    const { reportError, revalidateSession } = await createSocket();
    let ws = FakeWebSocket.instances[0];

    for (let attempt = 1; attempt <= 3; attempt++) {
      if (attempt > 1) ws = await reconnect(attempt);
      ws.open();
      ws.receive({ err: "authToken doesn't correspond with an active session", ip: '1.2.3.4' });
      ws.drop();
    }

    expect(reportError).not.toHaveBeenCalled();
    expect(revalidateSession).toHaveBeenCalledTimes(1);
  });

  it('still reports repeated closes without an error frame', async () => {
    const { reportError } = await createSocket();
    let ws = FakeWebSocket.instances[0];

    for (let attempt = 1; attempt <= 3; attempt++) {
      if (attempt > 1) ws = await reconnect(attempt);
      ws.open();
      ws.drop();
    }

    expect(reportError).toHaveBeenCalledTimes(1);
    expect(reportError.mock.calls[0][0].message).toContain('repeatedly closed');
  });

  it('accepts object content and ignores unknown types and missing content', async () => {
    const { reportError, receivedUserUpdate, notifications } = await createSocket();
    const ws = FakeWebSocket.instances[0];
    ws.open();

    ws.receive({ type: 'user-update', content: { userId: 'u', user: { status: 'active' } } });
    ws.receive({ type: 'notification', content: JSON.stringify({ id: 'n' }) });
    ws.receive({ type: 'clear-notification' });
    ws.receive({ type: 'see-notification', content: 'not_123' });

    expect(receivedUserUpdate).toHaveBeenCalledWith({ status: 'active' });
    await vi.waitFor(() => expect(notifications).toEqual([{ id: 'n' }]));
    expect(reportError).not.toHaveBeenCalled();
  });

  it('names the failing type or shape without the content', async () => {
    const { reportError } = await createSocket();
    const ws = FakeWebSocket.instances[0];
    ws.open();

    ws.receive({ type: 'notification', content: 'secret text' });
    ws.receive({ content: 'secret text' });
    ws.receive('secret text');

    await vi.waitFor(() => expect(reportError).toHaveBeenCalledTimes(3));
    const messages = reportError.mock.calls.map(([cause]) => cause.message);
    expect(messages).toEqual(
      expect.arrayContaining([
        'VRChat pipeline event handling failed: notification',
        'VRChat pipeline message parsing failed: no type, keys=content',
        'VRChat pipeline message parsing failed: not JSON',
      ])
    );
    expect(messages.join()).not.toContain('secret');
  });
});
