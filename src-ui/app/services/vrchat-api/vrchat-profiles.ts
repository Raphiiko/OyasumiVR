import type { CurrentUser } from 'vrchat';
import {
  getActiveVRChatProfile,
  normalizeVRChatAccountProfile,
  VRChatAccountProfile,
  VRChatApiSettings,
} from 'src-ui/app/models/vrchat-api-settings';

export type VRChatProfileSessionPatch = Partial<
  Pick<
    VRChatAccountProfile,
    | 'authCookie'
    | 'twoFactorCookie'
    | 'twoFactorCookieLoginIdentifierHash'
    | 'pendingTwoFactorLoginIdentifier'
    | 'rememberCredentials'
    | 'rememberedCredentials'
  >
>;

export function normalizeVRChatProfiles(settings: VRChatApiSettings): VRChatApiSettings {
  const profiles = settings.profiles.map(normalizeVRChatAccountProfile);
  const activeProfileId = profiles.some((profile) => profile.id === settings.activeProfileId)
    ? settings.activeProfileId
    : null;
  return { ...settings, profiles, activeProfileId };
}

export function createVRChatDraftProfile(settings: VRChatApiSettings): VRChatApiSettings {
  const active = getActiveVRChatProfile(settings);
  const draft = normalizeVRChatAccountProfile({
    id: crypto.randomUUID(),
    sourceProfileId: null,
    restoreProfileId: active?.draft ? active.restoreProfileId : (active?.id ?? null),
    draft: true,
  });
  return {
    ...settings,
    profiles: [draft, ...settings.profiles],
    activeProfileId: draft.id,
  };
}

export function createVRChatProfileAttempt(
  settings: VRChatApiSettings,
  profileId: string
): VRChatApiSettings {
  const source = settings.profiles.find((profile) => profile.id === profileId && !profile.draft);
  if (!source) throw new Error(`Unknown VRChat profile: ${profileId}`);
  const active = getActiveVRChatProfile(settings);
  const draft = normalizeVRChatAccountProfile({
    ...source,
    id: crypto.randomUUID(),
    sourceProfileId: source.id,
    restoreProfileId: active?.draft ? active.restoreProfileId : (active?.id ?? null),
    draft: true,
  });
  return {
    ...settings,
    profiles: [draft, ...settings.profiles.filter((profile) => !profile.draft)],
    activeProfileId: draft.id,
  };
}

export function getVRChatProfileAttemptSource(
  settings: VRChatApiSettings,
  profile: VRChatAccountProfile
): VRChatAccountProfile | null {
  if (!profile.sourceProfileId) return null;
  return settings.profiles.find((candidate) => candidate.id === profile.sourceProfileId) ?? null;
}

export function patchVRChatProfile(
  settings: VRChatApiSettings,
  profileId: string,
  patch: Partial<VRChatAccountProfile>
): VRChatApiSettings {
  if (!settings.profiles.some((profile) => profile.id === profileId)) return settings;
  return {
    ...settings,
    profiles: settings.profiles.map((profile) =>
      profile.id === profileId ? { ...profile, ...patch, id: profile.id } : profile
    ),
  };
}

export function setActiveVRChatProfile(
  settings: VRChatApiSettings,
  profileId: string | null
): VRChatApiSettings {
  if (profileId && !settings.profiles.some((profile) => profile.id === profileId)) {
    throw new Error(`Unknown VRChat profile: ${profileId}`);
  }
  return { ...settings, activeProfileId: profileId };
}

export function adoptVRChatProfileIdentity(
  settings: VRChatApiSettings,
  user: CurrentUser
): VRChatApiSettings {
  const active = settings.profiles.find((profile) => profile.id === settings.activeProfileId);
  if (!active) throw new Error('Cannot save a VRChat account without an active profile');

  const source = getVRChatProfileAttemptSource(settings, active);
  const matching = settings.profiles.find(
    (profile) => !profile.draft && profile.id !== active.id && profile.userId === user.id
  );
  const existing = source && (!source.userId || source.userId === user.id) ? source : matching;
  const updated = {
    ...active,
    sourceProfileId: null,
    restoreProfileId: null,
    protectedSecret: null,
    secretLocked: false,
    userId: user.id,
    username: user.username ?? null,
    displayName: user.displayName,
    draft: false,
  };
  if (!existing) {
    return {
      ...settings,
      profiles: [updated, ...settings.profiles.filter((profile) => profile.id !== active.id)],
    };
  }

  const merged =
    source?.id === existing.id
      ? { ...existing, ...updated, id: existing.id }
      : {
          ...existing,
          ...updated,
          id: existing.id,
          rememberCredentials: updated.rememberCredentials || existing.rememberCredentials,
          rememberedCredentials: updated.rememberedCredentials ?? existing.rememberedCredentials,
        };
  return {
    ...settings,
    activeProfileId: existing.id,
    profiles: [
      merged,
      ...settings.profiles.filter(
        (profile) => profile.id !== active.id && profile.id !== existing.id
      ),
    ],
  };
}

export function removeVRChatProfile(
  settings: VRChatApiSettings,
  profileId: string
): VRChatApiSettings {
  return {
    ...settings,
    activeProfileId: settings.activeProfileId === profileId ? null : settings.activeProfileId,
    profiles: settings.profiles.filter((profile) => profile.id !== profileId),
  };
}

export function pruneVRChatDraftProfiles(settings: VRChatApiSettings): VRChatApiSettings {
  const profiles = settings.profiles.filter((profile) => !profile.draft);
  return {
    ...settings,
    profiles,
    activeProfileId: profiles.some((profile) => profile.id === settings.activeProfileId)
      ? settings.activeProfileId
      : null,
  };
}
