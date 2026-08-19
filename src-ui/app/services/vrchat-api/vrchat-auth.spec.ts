import { BehaviorSubject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import type { CurrentUser } from 'vrchat';
import { VRChatApiSettings, VRCHAT_API_SETTINGS_DEFAULT } from '../../models/vrchat-api-settings';
import { ModalService } from '../modal.service';
import { VRChatAPI } from './vrchat-api';
import { VRChatAuth } from './vrchat-auth';

vi.mock('@tauri-apps/plugin-log', () => ({
  error: vi.fn(),
  info: vi.fn(),
}));

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
    const api = { verify2FA, getCurrentUser } as unknown as VRChatAPI;
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
    expect(getCurrentUser).toHaveBeenCalledOnce();
    expect(settings.value.authCookie).toBe('auth-cookie');
  });
});
