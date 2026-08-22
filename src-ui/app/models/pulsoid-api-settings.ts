export interface PulsoidApiSettings {
  version: 2;
  accessToken?: string;
  protectedAccessToken?: string;
  expiresAt?: number;
  username?: string;
}

export const PULSOID_API_SETTINGS_DEFAULT: PulsoidApiSettings = {
  version: 2,
};
