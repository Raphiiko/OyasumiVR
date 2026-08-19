import { BehaviorSubject, firstValueFrom } from 'rxjs';
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
    vi.advanceTimersByTime(60_000);
    await Promise.resolve();

    const login = auth.login('test', 'password');
    await login;

    finishRestore();
    await Promise.resolve();

    expect((await firstValueFrom(auth.user))?.id).toBe('usr_new');
    expect(clearCaches).toHaveBeenCalledOnce();
    expect(getCurrentUser.mock.calls[0][2]).toBeInstanceOf(AbortSignal);
    expect(getCurrentUser.mock.calls[0][2].aborted).toBe(true);
    expect(closeModal).not.toHaveBeenCalled();
  });
});
