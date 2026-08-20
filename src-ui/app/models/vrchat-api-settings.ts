export interface VRChatCredentials {
  username: string;
  password: string;
}

export interface VRChatAccountSecret {
  authCookie: string | null;
  twoFactorCookie: string | null;
  twoFactorCookieLoginIdentifierHash: string | null;
  pendingTwoFactorLoginIdentifier: string | null;
  rememberCredentials: boolean;
  rememberedCredentials: VRChatCredentials | null;
}

export interface VRChatAccountProfile {
  id: string;
  userId: string | null;
  username: string | null;
  displayName: string | null;
  draft: boolean;
  protectedSecret: string | null;
  secretLocked: boolean;
  authCookie: string | null;
  twoFactorCookie: string | null;
  twoFactorCookieLoginIdentifierHash: string | null;
  pendingTwoFactorLoginIdentifier: string | null;
  rememberCredentials: boolean;
  rememberedCredentials: VRChatCredentials | null;
}

export interface VRChatApiSettings {
  version: 6;
  profiles: VRChatAccountProfile[];
  activeProfileId: string | null;
  legacyCredentialCryptoKey: string | null;
}

export const VRCHAT_API_SETTINGS_DEFAULT: VRChatApiSettings = {
  version: 6,
  profiles: [],
  activeProfileId: null,
  legacyCredentialCryptoKey: null,
};

export const VRCHAT_ACCOUNT_SECRET_EMPTY: VRChatAccountSecret = {
  authCookie: null,
  twoFactorCookie: null,
  twoFactorCookieLoginIdentifierHash: null,
  pendingTwoFactorLoginIdentifier: null,
  rememberCredentials: false,
  rememberedCredentials: null,
};

export function getActiveVRChatProfile(settings: VRChatApiSettings): VRChatAccountProfile | null {
  return settings.profiles.find((profile) => profile.id === settings.activeProfileId) ?? null;
}

export function normalizeVRChatAccountProfile(
  profile: Partial<VRChatAccountProfile>
): VRChatAccountProfile {
  return {
    id: profile.id ?? crypto.randomUUID(),
    userId: profile.userId ?? null,
    username: profile.username ?? null,
    displayName: profile.displayName ?? null,
    draft: profile.draft ?? false,
    protectedSecret: profile.protectedSecret ?? null,
    secretLocked: profile.secretLocked ?? false,
    authCookie: profile.authCookie ?? null,
    twoFactorCookie: profile.twoFactorCookie ?? null,
    twoFactorCookieLoginIdentifierHash: profile.twoFactorCookieLoginIdentifierHash ?? null,
    pendingTwoFactorLoginIdentifier: profile.pendingTwoFactorLoginIdentifier ?? null,
    rememberCredentials: profile.rememberCredentials ?? false,
    rememberedCredentials: profile.rememberedCredentials ?? null,
  };
}

export function getVRChatAccountSecret(profile: VRChatAccountProfile): VRChatAccountSecret {
  return {
    authCookie: profile.authCookie,
    twoFactorCookie: profile.twoFactorCookie,
    twoFactorCookieLoginIdentifierHash: profile.twoFactorCookieLoginIdentifierHash,
    pendingTwoFactorLoginIdentifier: profile.pendingTwoFactorLoginIdentifier,
    rememberCredentials: profile.rememberCredentials,
    rememberedCredentials: profile.rememberedCredentials,
  };
}

export function parseVRChatAccountSecret(value: unknown): VRChatAccountSecret {
  if (!value || typeof value !== 'object') throw new Error('Invalid VRChat account secret');
  const secret = value as Record<string, unknown>;
  const credentials = secret['rememberedCredentials'];
  if (
    credentials !== null &&
    (typeof credentials !== 'object' ||
      typeof (credentials as Record<string, unknown>)['username'] !== 'string' ||
      typeof (credentials as Record<string, unknown>)['password'] !== 'string')
  ) {
    throw new Error('Invalid VRChat credentials');
  }
  for (const key of [
    'authCookie',
    'twoFactorCookie',
    'twoFactorCookieLoginIdentifierHash',
    'pendingTwoFactorLoginIdentifier',
  ]) {
    if (secret[key] !== null && typeof secret[key] !== 'string') {
      throw new Error(`Invalid VRChat account secret field: ${key}`);
    }
  }
  if (typeof secret['rememberCredentials'] !== 'boolean') {
    throw new Error('Invalid VRChat credential preference');
  }
  return secret as unknown as VRChatAccountSecret;
}
