export interface PulsoidApiSettings {
  version: 2;
  accessToken?: string;
  expiresAt?: number;
  username?: string;
}

export const PULSOID_API_SETTINGS_DEFAULT: PulsoidApiSettings = {
  version: 2,
};
