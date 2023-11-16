export interface VRChatApiSettings {
  version: 2;
  authCookie?: string;
  authCookieExpiry?: number;
  twoFactorCookie?: string;
  twoFactorCookieExpiry?: number;
  rememberCredentials: boolean;
  rememberedCredentials?: string | null;
  credentialCryptoKey?: string | null;
}

export const VRCHAT_API_SETTINGS_DEFAULT: VRChatApiSettings = {
  version: 2,
  rememberCredentials: false,
};
