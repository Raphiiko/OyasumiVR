export interface PulsoidApiSettings {
  version: 2;
  /** Protected with the Windows Data Protection API, never the plain token. */
  accessToken?: string;
  expiresAt?: number;
  username?: string;
}

export const PULSOID_API_SETTINGS_DEFAULT: PulsoidApiSettings = {
  version: 2,
};
