export interface PulsoidApiSettings {
  version: 1;
  accessToken?: string;
  expiresAt?: number;
  username?: string;
}

export const PULSOID_API_SETTINGS_DEFAULT: PulsoidApiSettings = {
  version: 1,
};
