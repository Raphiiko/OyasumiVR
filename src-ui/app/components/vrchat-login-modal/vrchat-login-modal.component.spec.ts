import { describe, expect, it, vi } from 'vitest';
import { VRChatLoginModalComponent } from './vrchat-login-modal.component';
import type { VRChatTwoFactorMethod } from '../../services/vrchat-api/vrchat-api';

interface LoginContext {
  error: string;
  cdr: { markForCheck: ReturnType<typeof vi.fn> };
  get2FACode: ReturnType<typeof vi.fn>;
  vrchat: { verify2FA: ReturnType<typeof vi.fn> };
  finishLogin: ReturnType<typeof vi.fn>;
  setLoginError: ReturnType<typeof vi.fn>;
}

async function loginWithTwoFactor(context: LoginContext, method: VRChatTwoFactorMethod) {
  await (
    VRChatLoginModalComponent.prototype as unknown as {
      loginWithTwoFactor(this: LoginContext, method: VRChatTwoFactorMethod): Promise<void>;
    }
  ).loginWithTwoFactor.call(context, method);
}

function createContext(): LoginContext {
  return {
    error: '',
    cdr: { markForCheck: vi.fn() },
    get2FACode: vi.fn(),
    vrchat: { verify2FA: vi.fn() },
    finishLogin: vi.fn(),
    setLoginError: vi.fn(),
  };
}

describe('VRChatLoginModalComponent 2FA', () => {
  it('prompts again after an invalid code', async () => {
    const context = createContext();
    context.get2FACode.mockResolvedValueOnce('111111').mockResolvedValueOnce('222222');
    context.vrchat.verify2FA.mockRejectedValueOnce('INVALID_CODE').mockResolvedValueOnce(undefined);

    await loginWithTwoFactor(context, 'totp');

    expect(context.get2FACode.mock.calls).toEqual([[false], [true]]);
    expect(context.vrchat.verify2FA.mock.calls).toEqual([
      ['111111', 'totp'],
      ['222222', 'totp'],
    ]);
    expect(context.finishLogin).toHaveBeenCalledOnce();
  });

  it('uses a changed 2FA challenge method', async () => {
    const context = createContext();
    context.get2FACode.mockResolvedValueOnce('111111').mockResolvedValueOnce('222222');
    context.vrchat.verify2FA
      .mockRejectedValueOnce('2FA_EMAILOTP_REQUIRED')
      .mockResolvedValueOnce(undefined);

    await loginWithTwoFactor(context, 'totp');

    expect(context.vrchat.verify2FA.mock.calls).toEqual([
      ['111111', 'totp'],
      ['222222', 'emailotp'],
    ]);
    expect(context.finishLogin).toHaveBeenCalledOnce();
  });

  it('stops when the 2FA prompt is cancelled', async () => {
    const context = createContext();
    context.get2FACode.mockResolvedValue(null);

    await loginWithTwoFactor(context, 'totp');

    expect(context.vrchat.verify2FA).not.toHaveBeenCalled();
    expect(context.finishLogin).not.toHaveBeenCalled();
  });
});
