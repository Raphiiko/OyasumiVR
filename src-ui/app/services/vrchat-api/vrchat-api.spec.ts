import { BehaviorSubject } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CurrentUser, LimitedUserFriend } from 'vrchat';
import { VRChatApiSettings, VRCHAT_API_SETTINGS_DEFAULT } from '../../models/vrchat-api-settings';
import { VRChatAPI } from './vrchat-api';

const httpFetch = vi.hoisted(() => vi.fn());

vi.mock('@tauri-apps/plugin-http', () => ({ fetch: httpFetch }));
vi.mock('@tauri-apps/plugin-log', () => ({
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
}));
vi.mock('src-ui/app/globals', () => ({
  CACHE_STORE: {
    delete: vi.fn(async () => {}),
    get: vi.fn(async () => null),
    set: vi.fn(async () => {}),
  },
}));

beforeEach(() => httpFetch.mockReset());

describe('VRChatAPI authentication', () => {
  it('omits the stored auth cookie from credentialed login', async () => {
    const settings = new BehaviorSubject<VRChatApiSettings>({
      ...VRCHAT_API_SETTINGS_DEFAULT,
      authCookie: 'auth-cookie',
      twoFactorCookie: 'two-factor-cookie',
    });
    const api = new VRChatAPI(settings, async () => {});
    httpFetch.mockResolvedValue(new Response('{}', { status: 500 }));

    await expect(api.getCurrentUser({ username: 'test', password: 'password' }, true)).rejects.toBe(
      'UNEXPECTED_RESPONSE'
    );

    const headers = httpFetch.mock.calls[0][1].headers as Record<string, string>;
    expect(headers.Cookie).toBe('twoFactorAuth=two-factor-cookie');
    expect(headers.Authorization).toMatch(/^Basic /);
  });

  it('rejects unsupported non-string 2FA methods without throwing a type error', async () => {
    const settings = new BehaviorSubject<VRChatApiSettings>(VRCHAT_API_SETTINGS_DEFAULT);
    const api = new VRChatAPI(settings, async () => {});
    httpFetch.mockResolvedValue(
      new Response(JSON.stringify({ requiresTwoFactorAuth: [null] }), { status: 200 })
    );

    await expect(api.getCurrentUser(undefined, true)).rejects.toBe('UNSUPPORTED_2FA_METHOD');
  });

  it('does not fail login when current-user cache persistence fails', async () => {
    const settings = new BehaviorSubject<VRChatApiSettings>(VRCHAT_API_SETTINGS_DEFAULT);
    const api = new VRChatAPI(settings, async () => {});
    const internals = api as unknown as {
      _currentUserCache: {
        set: ReturnType<typeof vi.fn>;
      };
    };
    internals._currentUserCache = {
      set: vi.fn(async () => {
        throw new Error('CACHE_WRITE_FAILED');
      }),
    };
    httpFetch.mockResolvedValue(
      new Response(JSON.stringify({ id: 'usr_test', displayName: 'Test User' }), { status: 200 })
    );

    const user = await api.getCurrentUser({ username: 'test', password: 'password' }, true);

    expect(user.id).toBe('usr_test');
  });

  it('does not persist response cookies after cache invalidation', async () => {
    const settings = new BehaviorSubject<VRChatApiSettings>(VRCHAT_API_SETTINGS_DEFAULT);
    let finishSettingsWrite: () => void = () => {};
    const updateSettings = vi.fn(
      (patch: Partial<VRChatApiSettings>) =>
        new Promise<void>((resolve) => {
          finishSettingsWrite = () => {
            settings.next({ ...settings.value, ...patch });
            resolve();
          };
        })
    );
    const api = new VRChatAPI(settings, updateSettings);
    const currentUserCache = {
      clear: vi.fn(async () => {}),
      set: vi.fn(async () => {}),
    };
    const emptyCache = { clear: vi.fn(async () => {}) };
    const internals = api as unknown as {
      _currentUserCache: typeof currentUserCache;
      _friendsCache: typeof emptyCache;
      _avatarCache: typeof emptyCache;
      _groupsCache: typeof emptyCache;
      _inviteMessageCaches: Record<string, typeof emptyCache>;
    };
    internals._currentUserCache = currentUserCache;
    internals._friendsCache = emptyCache;
    internals._avatarCache = emptyCache;
    internals._groupsCache = emptyCache;
    internals._inviteMessageCaches = {};
    httpFetch.mockResolvedValue({
      headers: {
        getSetCookie: () => ['auth=stale-auth; Path=/', 'twoFactorAuth=stale-two-factor; Path=/'],
      },
      json: async () => ({ id: 'usr_old', displayName: 'Old User' }),
      ok: true,
      status: 200,
    } as Response);

    const request = api.getCurrentUser(undefined, true);
    const rejectedRequest = expect(request).rejects.toBe('STALE_REQUEST');
    await vi.waitFor(() => expect(updateSettings).toHaveBeenCalledOnce());
    const clearing = api.clearCaches();
    finishSettingsWrite();
    await clearing;
    await rejectedRequest;

    expect(currentUserCache.set).not.toHaveBeenCalled();
    expect(updateSettings).toHaveBeenCalledOnce();
  });

  it('does not write the current-user cache after cookie parsing is invalidated', async () => {
    const api = new VRChatAPI(
      new BehaviorSubject<VRChatApiSettings>(VRCHAT_API_SETTINGS_DEFAULT),
      async () => {}
    );
    let finishCookieParsing: () => void = () => {};
    const parseResponseCookies = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishCookieParsing = resolve;
        })
    );
    const currentUserCache = {
      clear: vi.fn(async () => {}),
      set: vi.fn(async () => {}),
    };
    const emptyCache = { clear: vi.fn(async () => {}) };
    const internals = api as unknown as {
      _currentUserCache: typeof currentUserCache;
      _friendsCache: typeof emptyCache;
      _avatarCache: typeof emptyCache;
      _groupsCache: typeof emptyCache;
      _inviteMessageCaches: Record<string, typeof emptyCache>;
      parseResponseCookies: typeof parseResponseCookies;
    };
    internals._currentUserCache = currentUserCache;
    internals._friendsCache = emptyCache;
    internals._avatarCache = emptyCache;
    internals._groupsCache = emptyCache;
    internals._inviteMessageCaches = {};
    internals.parseResponseCookies = parseResponseCookies;
    httpFetch.mockResolvedValue(
      new Response(JSON.stringify({ id: 'usr_old', displayName: 'Old User' }), { status: 200 })
    );

    const request = api.getCurrentUser(undefined, true);
    const rejectedRequest = expect(request).rejects.toBe('STALE_REQUEST');
    await vi.waitFor(() => expect(parseResponseCookies).toHaveBeenCalledOnce());
    finishCookieParsing();
    const clearing = api.clearCaches();

    await rejectedRequest;
    await clearing;
    expect(currentUserCache.set).not.toHaveBeenCalled();
  });

  it('awaits every cache deletion without blocking on a failure', async () => {
    const api = new VRChatAPI(
      new BehaviorSubject<VRChatApiSettings>(VRCHAT_API_SETTINGS_DEFAULT),
      async () => {}
    );
    let finishDelete: () => void = () => {};
    const pendingDelete = new Promise<void>((resolve) => {
      finishDelete = resolve;
    });
    const currentUserCache = { clear: vi.fn(() => pendingDelete) };
    const otherCaches = Array.from({ length: 7 }, () => ({ clear: vi.fn(async () => {}) }));
    otherCaches[0].clear.mockRejectedValue(new Error('CACHE_DELETE_FAILED'));
    const internals = api as unknown as {
      _currentUserCache: typeof currentUserCache;
      _friendsCache: (typeof otherCaches)[number];
      _avatarCache: (typeof otherCaches)[number];
      _groupsCache: (typeof otherCaches)[number];
      _inviteMessageCaches: Record<string, (typeof otherCaches)[number]>;
    };
    internals._currentUserCache = currentUserCache;
    internals._friendsCache = otherCaches[0];
    internals._avatarCache = otherCaches[1];
    internals._groupsCache = otherCaches[2];
    internals._inviteMessageCaches = {
      message: otherCaches[3],
      response: otherCaches[4],
      request: otherCaches[5],
      requestResponse: otherCaches[6],
    };
    let completed = false;

    const clearing = api.clearCaches().then(() => (completed = true));
    await vi.waitFor(() =>
      expect(otherCaches.every((cache) => cache.clear.mock.calls.length === 1)).toBe(true)
    );
    expect(completed).toBe(false);

    finishDelete();
    await clearing;
    expect(completed).toBe(true);
  });

  it('waits for an in-flight friends request before returning its cache', async () => {
    const api = new VRChatAPI(
      new BehaviorSubject<VRChatApiSettings>(VRCHAT_API_SETTINGS_DEFAULT),
      async () => {}
    );
    const friend = { id: 'usr_friend' } as LimitedUserFriend;
    let finishFetch: () => void = () => {};
    const firstFetch = new Promise<LimitedUserFriend[]>((resolve) => {
      finishFetch = () => resolve([friend]);
    });
    let cachedFriends: LimitedUserFriend[] | undefined;
    const friendsCache = {
      get: vi.fn(() => cachedFriends),
      set: vi.fn(async (friends: LimitedUserFriend[]) => {
        cachedFriends = friends;
      }),
    };
    const fetchPaginatedData = vi
      .fn()
      .mockImplementationOnce(() => firstFetch)
      .mockResolvedValueOnce([]);
    const internals = api as unknown as {
      user: BehaviorSubject<CurrentUser | null>;
      _friendsCache: typeof friendsCache;
      fetchPaginatedData: typeof fetchPaginatedData;
    };
    internals.user = new BehaviorSubject({ id: 'usr_test' } as CurrentUser);
    internals._friendsCache = friendsCache;
    internals.fetchPaginatedData = fetchPaginatedData;

    const firstListing = api.listFriends(true);
    await vi.waitFor(() => expect(fetchPaginatedData).toHaveBeenCalledOnce());
    let secondCompleted = false;
    const secondListing = api.listFriends(true).then((friends) => {
      secondCompleted = true;
      return friends;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(secondCompleted).toBe(false);

    finishFetch();
    await expect(firstListing).resolves.toEqual([friend]);
    await expect(secondListing).resolves.toEqual([friend]);
    expect(fetchPaginatedData).toHaveBeenCalledTimes(2);
  });

  it('does not repopulate the friends cache after it is cleared', async () => {
    const api = new VRChatAPI(
      new BehaviorSubject<VRChatApiSettings>(VRCHAT_API_SETTINGS_DEFAULT),
      async () => {}
    );
    const friend = { id: 'usr_friend' } as LimitedUserFriend;
    let finishFetch: () => void = () => {};
    const firstFetch = new Promise<LimitedUserFriend[]>((resolve) => {
      finishFetch = () => resolve([friend]);
    });
    const friendsCache = {
      get: vi.fn(() => undefined),
      set: vi.fn(async () => {}),
      clear: vi.fn(async () => {}),
    };
    const emptyCache = { clear: vi.fn(async () => {}) };
    const fetchPaginatedData = vi
      .fn()
      .mockImplementationOnce(() => firstFetch)
      .mockResolvedValueOnce([]);
    const internals = api as unknown as {
      user: BehaviorSubject<CurrentUser | null>;
      _currentUserCache: typeof emptyCache;
      _friendsCache: typeof friendsCache;
      _avatarCache: typeof emptyCache;
      _groupsCache: typeof emptyCache;
      _inviteMessageCaches: Record<string, typeof emptyCache>;
      fetchPaginatedData: typeof fetchPaginatedData;
    };
    internals.user = new BehaviorSubject({ id: 'usr_old' } as CurrentUser);
    internals._currentUserCache = emptyCache;
    internals._friendsCache = friendsCache;
    internals._avatarCache = emptyCache;
    internals._groupsCache = emptyCache;
    internals._inviteMessageCaches = {};
    internals.fetchPaginatedData = fetchPaginatedData;

    const listing = api.listFriends(true);
    await vi.waitFor(() => expect(fetchPaginatedData).toHaveBeenCalledOnce());
    await api.clearCaches();
    finishFetch();
    await expect(listing).rejects.toBe('STALE_REQUEST');

    expect(friendsCache.set).not.toHaveBeenCalled();
  });
});
