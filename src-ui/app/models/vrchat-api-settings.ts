export interface VRChatApiSettings {
  version: 2;
  authCookie?: string;
  authCookieExpiry?: number;
  twoFactorCookie?: string;
  twoFactorCookieExpiry?: number;
}

export const VRCHAT_API_SETTINGS_DEFAULT: VRChatApiSettings = {
  version: 2,
};
