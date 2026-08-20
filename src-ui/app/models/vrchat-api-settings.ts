export interface VRChatApiSettings {
  version: 4;
  authCookie: string | null;
  authCookieExpiry: number | null;
  twoFactorCookie: string | null;
  twoFactorCookieExpiry: number | null;
  twoFactorCookieLoginIdentifierHash: string | null;
  encryptedPendingTwoFactorLoginIdentifier: string | null;
  rememberCredentials: boolean;
  rememberedCredentials: string | null;
  credentialCryptoKey: string | null;
}

export const VRCHAT_API_SETTINGS_DEFAULT: VRChatApiSettings = {
  version: 4,
  authCookie: null,
  authCookieExpiry: null,
  twoFactorCookie: null,
  twoFactorCookieExpiry: null,
  twoFactorCookieLoginIdentifierHash: null,
  encryptedPendingTwoFactorLoginIdentifier: null,
  rememberCredentials: false,
  rememberedCredentials: null,
  credentialCryptoKey: null,
};
