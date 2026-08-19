import { BehaviorSubject, firstValueFrom, of } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CurrentUser } from 'vrchat';
import { VRChatApiSettings, VRCHAT_API_SETTINGS_DEFAULT } from '../../models/vrchat-api-settings';
import { ModalService } from '../modal.service';
import { VRChatAPI } from './vrchat-api';
import { VRChatAuth } from './vrchat-auth';

vi.mock('@tauri-apps/plugin-log', () => ({
  error: vi.fn(),
  info: vi.fn(),
}));

afterEach(() => vi.useRealTimers());

describe('VRChatAuth', () => {
  it('restores a valid session during startup', async () => {
    vi.useFakeTimers();
    const user = { id: 'usr_test', displayName: 'Test User' } as CurrentUser;
    const api = {
      getCurrentUser: vi.fn(async () => user),
      listFriends: vi.fn(async () => []),
    } as unknown as VRChatAPI;
    const auth = new VRChatAuth(
      api,
      {} as ModalService,
      async () => {},
      new BehaviorSubject<VRChatApiSettings>({
        ...VRCHAT_API_SETTINGS_DEFAULT,
        authCookie: 'auth-cookie',
      })
    );

    await auth.init();

    expect(await firstValueFrom(auth.user)).toBe(user);
    expect(await firstValueFrom(auth.status)).toBe('LOGGED_IN');
  });

  it('waits for 2FA verification before fetching the current user', async () => {
    const settings = new BehaviorSubject<VRChatApiSettings>({
      ...VRCHAT_API_SETTINGS_DEFAULT,
      authCookie: 'auth-cookie',
    });
    let finishVerification: () => void = () => {};
    const verify2FA = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishVerification = resolve;
        })
    );
    const getCurrentUser = vi.fn(async () => ({
      id: 'usr_test',
      displayName: 'Test User',
    })) as unknown as () => Promise<CurrentUser>;
    const api = {
      clearCaches: vi.fn(async () => {}),
      verify2FA,
      getCurrentUser,
    } as unknown as VRChatAPI;
    const modalService = {} as ModalService;
    const updateSettings = async (patch: Partial<VRChatApiSettings>) => {
      settings.next({ ...settings.value, ...patch });
    };
    const auth = new VRChatAuth(api, modalService, updateSettings, settings);
    (
      auth as unknown as {
        _status: BehaviorSubject<'PRE_INIT' | 'LOGGED_OUT' | 'LOGGED_IN'>;
      }
    )._status.next('LOGGED_OUT');

    const login = auth.verify2FA('123456', 'totp');
    await vi.waitFor(() => expect(verify2FA).toHaveBeenCalledOnce());
    expect(getCurrentUser).not.toHaveBeenCalled();

    finishVerification();
    await login;

    expect(getCurrentUser).toHaveBeenCalledOnce();
  });

  it('does not retry a new 2FA challenge after verification', async () => {
    const getCurrentUser = vi.fn(async () => {
      throw '2FA_EMAILOTP_REQUIRED';
    });
    const api = { getCurrentUser } as unknown as VRChatAPI;
    const auth = new VRChatAuth(
      api,
      {} as ModalService,
      async () => {},
      new BehaviorSubject<VRChatApiSettings>(VRCHAT_API_SETTINGS_DEFAULT)
    );

    await expect(
      (
        auth as unknown as {
          getCurrentUserAfter2FA(): Promise<CurrentUser>;
        }
      ).getCurrentUserAfter2FA()
    ).rejects.toBe('2FA_EMAILOTP_REQUIRED');
    expect(getCurrentUser).toHaveBeenCalledOnce();
  });

  it('retries a transient current-user failure after 2FA', async () => {
    vi.useFakeTimers();
    const user = { id: 'usr_test', displayName: 'Test User' } as CurrentUser;
    const getCurrentUser = vi.fn().mockRejectedValueOnce('NETWORK_FAILURE').mockResolvedValue(user);
    const auth = new VRChatAuth(
      { getCurrentUser } as unknown as VRChatAPI,
      {} as ModalService,
      async () => {},
      new BehaviorSubject<VRChatApiSettings>(VRCHAT_API_SETTINGS_DEFAULT)
    );

    const request = (
      auth as unknown as {
        getCurrentUserAfter2FA(): Promise<CurrentUser>;
      }
    ).getCurrentUserAfter2FA();
    await vi.advanceTimersByTimeAsync(1_000);

    await expect(request).resolves.toBe(user);
    expect(getCurrentUser).toHaveBeenCalledTimes(2);
  });

  it('lets VRChat validate a cookie after its local expiry date', async () => {
    const settings = new BehaviorSubject<VRChatApiSettings>({
      ...VRCHAT_API_SETTINGS_DEFAULT,
      authCookie: 'auth-cookie',
      authCookieExpiry: 1,
    });
    const getCurrentUser = vi.fn(async () => ({
      id: 'usr_test',
      displayName: 'Test User',
    })) as unknown as () => Promise<CurrentUser>;
    const api = { getCurrentUser } as unknown as VRChatAPI;
    const updateSettings = async (patch: Partial<VRChatApiSettings>) => {
      settings.next({ ...settings.value, ...patch });
    };
    const auth = new VRChatAuth(api, {} as ModalService, updateSettings, settings);
    const result = await (
      auth as unknown as {
        loadSession(): Promise<{ status: string }>;
      }
    ).loadSession();

    expect(result.status).toBe('RESTORED');
    expect(getCurrentUser).toHaveBeenCalledWith(undefined, true, undefined);
    expect(settings.value.authCookie).toBe('auth-cookie');
  });

  it('opens the matching 2FA prompt during session restore', async () => {
    vi.useFakeTimers();
    const settings = new BehaviorSubject<VRChatApiSettings>({
      ...VRCHAT_API_SETTINGS_DEFAULT,
      authCookie: 'auth-cookie',
    });
    const api = {
      getCurrentUser: vi.fn(async () => {
        throw '2FA_TOTP_REQUIRED';
      }),
    } as unknown as VRChatAPI;
    const addModal = vi.fn(() => of(undefined));
    const auth = new VRChatAuth(
      api,
      { isModalOpen: vi.fn(() => false), addModal } as unknown as ModalService,
      async () => {},
      settings
    );

    await auth.init();

    expect(addModal.mock.calls[0][1]).toMatchObject({
      autoLogin: false,
      twoFactorMethod: 'totp',
    });
  });

  it('keeps the stored session after an unrecognized authentication rejection', async () => {
    const settings = new BehaviorSubject<VRChatApiSettings>({
      ...VRCHAT_API_SETTINGS_DEFAULT,
      authCookie: 'auth-cookie',
    });
    const clearCaches = vi.fn(async () => {});
    const api = {
      clearCaches,
      getCurrentUser: vi.fn(async () => {
        throw 'AUTHENTICATION_REJECTED';
      }),
    } as unknown as VRChatAPI;
    const updateSettings = vi.fn(async (patch: Partial<VRChatApiSettings>) => {
      settings.next({ ...settings.value, ...patch });
    });
    const auth = new VRChatAuth(api, {} as ModalService, updateSettings, settings);

    const result = await (
      auth as unknown as {
        loadSession(): Promise<{ status: string; error?: string }>;
      }
    ).loadSession();

    expect(result).toEqual({ status: 'LOGIN_REQUIRED', error: 'UNEXPECTED_RESPONSE' });
    expect(clearCaches).not.toHaveBeenCalled();
    expect(updateSettings).not.toHaveBeenCalled();
    expect(settings.value.authCookie).toBe('auth-cookie');
  });

  it('preserves the stored session when credential login fails', async () => {
    const settings = new BehaviorSubject<VRChatApiSettings>({
      ...VRCHAT_API_SETTINGS_DEFAULT,
      authCookie: 'auth-cookie',
      twoFactorCookie: 'two-factor-cookie',
    });
    const api = {
      clearCaches: vi.fn(async () => {}),
      getCurrentUser: vi.fn(async () => {
        throw 'NETWORK_FAILURE';
      }),
    } as unknown as VRChatAPI;
    const updateSettings = async (patch: Partial<VRChatApiSettings>) => {
      settings.next({ ...settings.value, ...patch });
    };
    const auth = new VRChatAuth(api, {} as ModalService, updateSettings, settings);
    (
      auth as unknown as {
        _status: BehaviorSubject<'PRE_INIT' | 'LOGGED_OUT' | 'LOGGED_IN'>;
      }
    )._status.next('LOGGED_OUT');

    await expect(auth.login('test', 'password')).rejects.toBe('NETWORK_FAILURE');

    expect(settings.value.authCookie).toBe('auth-cookie');
    expect(settings.value.twoFactorCookie).toBe('two-factor-cookie');
  });

  it('preloads friends for each newly logged-in account', async () => {
    vi.useFakeTimers();
    const listFriends = vi.fn().mockResolvedValueOnce([]).mockRejectedValueOnce('STALE_REQUEST');
    const api = { listFriends } as unknown as VRChatAPI;
    const auth = new VRChatAuth(
      api,
      {} as ModalService,
      async () => {},
      new BehaviorSubject<VRChatApiSettings>(VRCHAT_API_SETTINGS_DEFAULT)
    );
    await auth.init();
    const internals = auth as unknown as {
      _user: BehaviorSubject<CurrentUser | null>;
    };

    internals._user.next({ id: 'usr_first' } as CurrentUser);
    await vi.advanceTimersByTimeAsync(500);
    internals._user.next(null);
    await vi.advanceTimersByTimeAsync(500);
    internals._user.next({ id: 'usr_second' } as CurrentUser);
    await vi.advanceTimersByTimeAsync(500);

    expect(listFriends).toHaveBeenCalledTimes(2);
  });

  it('discards an in-flight restore before credential login', async () => {
    vi.useFakeTimers();
    const settings = new BehaviorSubject<VRChatApiSettings>({
      ...VRCHAT_API_SETTINGS_DEFAULT,
      authCookie: 'auth-cookie',
    });
    const restoredUser = { id: 'usr_old', displayName: 'Old User' } as CurrentUser;
    const loggedInUser = { id: 'usr_new', displayName: 'New User' } as CurrentUser;
    let finishRestore: () => void = () => {};
    const getCurrentUser = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<CurrentUser>((resolve) => {
            finishRestore = () => resolve(restoredUser);
          })
      )
      .mockResolvedValueOnce(loggedInUser);
    const clearCaches = vi.fn(async () => {});
    const closeModal = vi.fn();
    const api = { clearCaches, getCurrentUser } as unknown as VRChatAPI;
    const modalService = { closeModal } as unknown as ModalService;
    const updateSettings = async (patch: Partial<VRChatApiSettings>) => {
      settings.next({ ...settings.value, ...patch });
    };
    const auth = new VRChatAuth(api, modalService, updateSettings, settings);
    const internals = auth as unknown as {
      _status: BehaviorSubject<'PRE_INIT' | 'LOGGED_OUT' | 'LOGGED_IN'>;
      scheduleSessionRestore(): void;
    };
    internals._status.next('LOGGED_OUT');
    internals.scheduleSessionRestore();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(getCurrentUser).toHaveBeenCalledOnce();

    const login = auth.login('test', 'password');
    await login;

    finishRestore();
    await vi.advanceTimersByTimeAsync(0);

    expect((await firstValueFrom(auth.user))?.id).toBe('usr_new');
    expect(clearCaches).toHaveBeenCalledOnce();
    expect(getCurrentUser.mock.calls[0][2]).toBeInstanceOf(AbortSignal);
    expect(getCurrentUser.mock.calls[0][2].aborted).toBe(true);
    expect(closeModal).not.toHaveBeenCalled();
  });

  it('completes a scheduled session restore', async () => {
    vi.useFakeTimers();
    const user = { id: 'usr_test', displayName: 'Test User' } as CurrentUser;
    const getCurrentUser = vi.fn(async () => user);
    const closeModal = vi.fn();
    const auth = new VRChatAuth(
      { getCurrentUser } as unknown as VRChatAPI,
      { closeModal } as unknown as ModalService,
      async () => {},
      new BehaviorSubject<VRChatApiSettings>({
        ...VRCHAT_API_SETTINGS_DEFAULT,
        authCookie: 'auth-cookie',
      })
    );
    const internals = auth as unknown as {
      _status: BehaviorSubject<'PRE_INIT' | 'LOGGED_OUT' | 'LOGGED_IN'>;
      scheduleSessionRestore(): void;
    };
    internals._status.next('LOGGED_OUT');

    internals.scheduleSessionRestore();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(await firstValueFrom(auth.user)).toBe(user);
    expect(await firstValueFrom(auth.status)).toBe('LOGGED_IN');
    expect(closeModal).toHaveBeenCalledOnce();
  });

  it('does not clear credentials after an in-flight restore is cancelled', async () => {
    const settings = new BehaviorSubject<VRChatApiSettings>({
      ...VRCHAT_API_SETTINGS_DEFAULT,
      authCookie: 'auth-cookie',
    });
    let finishCacheClear: () => void = () => {};
    const clearCaches = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishCacheClear = resolve;
        })
    );
    const api = {
      clearCaches,
      getCurrentUser: vi.fn(async () => {
        throw 'INVALID_CREDENTIALS';
      }),
    } as unknown as VRChatAPI;
    const updateSettings = vi.fn(async (patch: Partial<VRChatApiSettings>) => {
      settings.next({ ...settings.value, ...patch });
    });
    const auth = new VRChatAuth(api, {} as ModalService, updateSettings, settings);
    const abortController = new AbortController();

    const restoring = (
      auth as unknown as {
        loadSession(signal: AbortSignal): Promise<{ status: string }>;
      }
    ).loadSession(abortController.signal);
    await vi.waitFor(() => expect(clearCaches).toHaveBeenCalledOnce());
    abortController.abort();
    finishCacheClear();

    await expect(restoring).resolves.toEqual({ status: 'RETRY' });
    expect(updateSettings).not.toHaveBeenCalled();
    expect(settings.value.authCookie).toBe('auth-cookie');
  });
});
