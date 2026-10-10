import { describe, expect, it } from 'vitest';
import { normalizeVRChatAccountProfile, rememberCredentialsByDefault } from './vrchat-api-settings';

describe('rememberCredentialsByDefault', () => {
  it('starts on without a profile or with a fresh draft', () => {
    expect(rememberCredentialsByDefault(null)).toBe(true);
    expect(rememberCredentialsByDefault(normalizeVRChatAccountProfile({ draft: true }))).toBe(true);
  });

  it('keeps the stored choice of a known account', () => {
    const known = normalizeVRChatAccountProfile({ userId: 'usr_1', rememberCredentials: false });
    expect(rememberCredentialsByDefault(known)).toBe(false);
    expect(rememberCredentialsByDefault({ ...known, rememberCredentials: true })).toBe(true);
  });

  it('keeps the stored choice of a migrated profile without a user id', () => {
    const migrated = normalizeVRChatAccountProfile({ userId: null, rememberCredentials: false });
    expect(rememberCredentialsByDefault(migrated)).toBe(false);
  });

  it('keeps the source choice in a profile attempt', () => {
    const attempt = normalizeVRChatAccountProfile({
      draft: true,
      sourceProfileId: 'source',
      rememberCredentials: false,
    });
    expect(rememberCredentialsByDefault(attempt)).toBe(false);
  });
});
