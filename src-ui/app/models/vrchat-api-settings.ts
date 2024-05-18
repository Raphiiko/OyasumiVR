export interface VRChatApiSettings {
  version: 2;
  authCookie: string | null;
  authCookieExpiry: number | null;
  twoFactorCookie: string | null;
  twoFactorCookieExpiry: number | null;
  rememberCredentials: boolean;
  rememberedCredentials: string | null;
  credentialCryptoKey: string | null;
}

export const VRCHAT_API_SETTINGS_DEFAULT: VRChatApiSettings = {
  version: 2,
  authCookie: null,
  authCookieExpiry: null,
  twoFactorCookie: null,
  twoFactorCookieExpiry: null,
  rememberCredentials: false,
  rememberedCredentials: null,
  credentialCryptoKey: null,
};
