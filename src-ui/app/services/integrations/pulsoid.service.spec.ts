import '@angular/compiler';
import { firstValueFrom } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PulsoidService } from './pulsoid.service';
import { ToastService } from '../toast.service';

const { fetch, storeGet } = vi.hoisted(() => ({ fetch: vi.fn(), storeGet: vi.fn() }));
vi.mock('@tauri-apps/plugin-http', () => ({ fetch }));
vi.mock('@tauri-apps/plugin-log', () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock('@tauri-apps/plugin-shell', () => ({ open: vi.fn() }));
vi.mock('../../utils/secrets', () => ({
  protectSecret: async (plain: string) => `protected:${plain}`,
  unprotectSecret: async (stored?: string) => stored?.replace('protected:', '') ?? null,
}));
vi.mock('../../globals', () => ({
  PULSOID_CLIENT_ID: 'client',
  PULSOID_REDIRECT_URI: 'oyasumivr://pulsoid',
  SETTINGS_KEY_PULSOID_API: 'PULSOID_API',
  SETTINGS_STORE: { get: storeGet, set: vi.fn() },
}));

const HEART_RATE_ONLY = ['data:heart_rate:read', 'profile:read'];
const WITH_BATTERY_LEVEL = ['data:heart_rate:read', 'data:battery_level:read', 'profile:read'];

class FakeSocket {
  static OPEN = 1;
  static created: FakeSocket[] = [];
  readyState = 0;
  close = vi.fn();
  constructor(public url: string) {
    FakeSocket.created.push(this);
  }
}

/** Answers each Pulsoid request by its route and token; a missing scope entry stalls until aborted. */
function servePulsoid(scopesByToken: Record<string, string[] | 'unauthorized'>) {
  fetch.mockImplementation(
    (url: string, init: { headers: { Authorization: string }; signal: AbortSignal }) => {
      const token = init.headers.Authorization.replace('Bearer ', '');
      if (url.endsWith('/token/validate')) {
        const scopes = scopesByToken[token];
        if (!scopes) {
          return new Promise((_, reject) =>
            init.signal.addEventListener('abort', () => reject(new Error('Request cancelled')))
          );
        }
        if (scopes === 'unauthorized') return Promise.resolve({ ok: false, status: 401 });
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ scopes }) });
      }
      if (url.endsWith('/profile')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ username: 'Raphii' }),
        });
      }
      return Promise.resolve({ ok: false, status: 412 });
    }
  );
}

const openSockets = () => FakeSocket.created.filter((socket) => !socket.close.mock.calls.length);

async function start(storedToken: string | null) {
  storeGet.mockResolvedValue(
    storedToken
      ? {
          version: 2,
          accessToken: `protected:${storedToken}`,
          expiresAt: Math.floor(Date.now() / 1000) + 3600,
          username: 'Raphii',
        }
      : undefined
  );
  const service = new PulsoidService({ show: vi.fn() } as unknown as ToastService);
  await service.init();
  await vi.advanceTimersByTimeAsync(0);
  return service;
}

async function login(service: PulsoidService, accessToken: string) {
  const state = new URL(service.getLoginUrl()).searchParams.get('state')!;
  await service.handleDeepLink(
    '',
    {},
    { state: [state], access_token: [accessToken], expires_in: ['3600'] }
  );
  await vi.advanceTimersByTimeAsync(0);
}

const scopeMissing = (service: PulsoidService) => firstValueFrom(service.batteryLevelScopeMissing);

beforeEach(() => {
  FakeSocket.created = [];
  vi.useFakeTimers();
  vi.stubGlobal('WebSocket', FakeSocket);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

describe('PulsoidService.batteryLevelScopeMissing', () => {
  it('is true for a login whose token lacks the battery level scope', async () => {
    servePulsoid({ old: HEART_RATE_ONLY });
    const service = await start('old');

    expect(await scopeMissing(service)).toBe(true);
  });

  it('is false for a login whose token has the battery level scope', async () => {
    servePulsoid({ current: WITH_BATTERY_LEVEL });
    const service = await start('current');

    expect(await scopeMissing(service)).toBe(false);
  });

  it('is false without a Pulsoid login', async () => {
    servePulsoid({});
    const service = await start(null);

    expect(await scopeMissing(service)).toBe(false);
  });

  it('is false when Pulsoid rejects the token', async () => {
    servePulsoid({ revoked: 'unauthorized' });
    const service = await start('revoked');

    expect(await scopeMissing(service)).toBe(false);
  });

  it('is false while the scopes of a new login are still being looked up', async () => {
    servePulsoid({ old: HEART_RATE_ONLY });
    const service = await start('old');

    await login(service, 'pending');

    expect(await scopeMissing(service)).toBe(false);
  });

  it('turns false once the user reconnects with the battery level scope', async () => {
    servePulsoid({ old: HEART_RATE_ONLY, current: WITH_BATTERY_LEVEL });
    const service = await start('old');

    await login(service, 'current');

    expect(await scopeMissing(service)).toBe(false);
  });

  it('turns false after logging out', async () => {
    servePulsoid({ old: HEART_RATE_ONLY });
    const service = await start('old');

    await service.logout();
    await vi.advanceTimersByTimeAsync(0);

    expect(await scopeMissing(service)).toBe(false);
  });
});

describe('PulsoidService socket', () => {
  it('requests the battery level only when the token has its scope', async () => {
    servePulsoid({ old: HEART_RATE_ONLY, current: WITH_BATTERY_LEVEL });
    const service = await start('old');
    expect(openSockets().map((socket) => socket.url)).toEqual([
      expect.stringContaining('/api/v2/data/real_time?access_token=old&types=heart_rate'),
    ]);

    await login(service, 'current');

    expect(openSockets().map((socket) => socket.url)).toEqual([
      expect.stringContaining('access_token=current&types=heart_rate,battery_level'),
    ]);
  });

  it('connects for heart rate only when the scope lookup stalls', async () => {
    servePulsoid({});
    await start('stalled');
    expect(openSockets()).toEqual([]);

    await vi.advanceTimersByTimeAsync(5000);

    expect(openSockets().map((socket) => socket.url)).toEqual([
      expect.stringContaining('access_token=stalled&types=heart_rate'),
    ]);
  });

  it('closes the previous account socket as soon as the token changes', async () => {
    servePulsoid({ old: HEART_RATE_ONLY });
    const service = await start('old');
    expect(openSockets()).toHaveLength(1);

    await login(service, 'pending');

    expect(openSockets()).toEqual([]);
  });

  it('opens no socket when the user logs out during a scope lookup retry', async () => {
    servePulsoid({});
    const service = await start('stalled');
    await vi.advanceTimersByTimeAsync(10000);

    await service.logout();
    await vi.advanceTimersByTimeAsync(5000);

    expect(openSockets()).toEqual([]);
  });
});
