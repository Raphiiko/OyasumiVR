export interface VRChatApiSettings {
  version: 1;
  apiKey?: string;
  apiKeyExpiry?: number;
  authCookie?: string;
  authCookieExpiry?: number;
  twoFactorCookie?: string;
  twoFactorCookieExpiry?: number;
}

export const VRCHAT_API_SETTINGS_DEFAULT: VRChatApiSettings = {
  version: 1,
};
