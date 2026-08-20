import { ClientOptions, fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { error, info, warn } from '@tauri-apps/plugin-log';
import { getVersion } from 'src-ui/app/utils/app-utils';
import { TaskQueue } from 'src-ui/app/utils/task-queue';
import { parseSetCookie as parseSetCookieHeader } from 'set-cookie-parser';
import { stringifySetCookie as serializeCookie } from 'cookie';
import type { CurrentUser, InviteMessage, LimitedUserFriend, LimitedUserGroups } from 'vrchat';
import { CachedValue } from 'src-ui/app/utils/cached-value';
import { AvatarEx, InviteMessageEx, InviteMessageType, UserStatus } from 'src-ui/app/models/vrchat';
import { uniqBy } from 'lodash';
import { BehaviorSubject, distinctUntilChanged, firstValueFrom, Observable } from 'rxjs';
import { getActiveVRChatProfile, VRChatApiSettings } from 'src-ui/app/models/vrchat-api-settings';
import { VRChatProfileSessionPatch } from './vrchat-profiles';
import { CompletionResult } from 'src-ui/app/utils/completer';

async function requestVRChat(
  input: URL | Request | string,
  init?: RequestInit & ClientOptions
): Promise<Response> {
  info(`[VRChat] API Request: ${input}`);
  try {
    const response = await tauriFetch(input, {
      ...init,
    });
    return response;
  } catch (e) {
    error(`[VRChat] HTTP Request Error: ${e}`);
    throw e;
  }
}

const BASE_URL = 'https://api.vrchat.cloud/api/1';
const MAX_VRCHAT_FRIENDS = 65536;
const MAX_FAVOURITE_AVATARS = 500;
const MAX_UPLOADED_AVATARS = 1000;
const RESOURCE_CACHE_TTL = 60 * 60_000;
const PAGE_SIZE = 100;
const DEFAULT_PAGE_LIMIT = 500;
const DEFAULT_RATE_LIMIT_RETRIES = 5;
const DEFAULT_RATE_LIMIT_DELAY = 5_000;
const PROFILE_LOGOUT_TIMEOUT = 10_000;

export const VRCHAT_API_STALE_REQUEST = 'STALE_REQUEST';

export type VRChatTwoFactorMethod = 'totp' | 'emailotp';

export interface VRChatCredentials {
  username: string;
  password: string;
}

interface CurrentUserRequestOptions {
  credentials?: VRChatCredentials;
  signal?: AbortSignal;
  includeTwoFactorCookie?: boolean;
}

interface CurrentUserChallenge {
  requiresTwoFactorAuth: string[];
}

interface CurrentUserErrorResponse {
  error?: { message?: string };
}

interface VerifyTwoFactorResponse {
  verified?: boolean;
}

interface RequestHeaderOptions {
  contentType?: string;
  includeAuthCookie?: boolean;
  includeTwoFactorCookie?: boolean;
}

interface PaginatedRequestOptions {
  url: string;
  apiCallTypeId: string;
  query?: Record<string, string>;
  maxEntries?: number;
  rateLimit?: {
    maxRetries?: number;
    delay?: number;
  };
}

export function twoFactorMethodFromError(error: unknown): VRChatTwoFactorMethod | undefined {
  switch (error) {
    case '2FA_TOTP_REQUIRED':
      return 'totp';
    case '2FA_EMAILOTP_REQUIRED':
      return 'emailotp';
    default:
      return undefined;
  }
}

export class VRChatAPI {
  private userAgent!: string;
  /** Changes whenever session-bound results must be discarded. */
  private cacheGeneration = 0;
  /** Blocks socket cache updates while persisted caches are being cleared. */
  private activeCacheClears = 0;
  /** Writes that must settle before a cache clear can finish. */
  private readonly pendingPersistenceWrites = new Set<Promise<unknown>>();
  private readonly apiCallQueue = new TaskQueue({
    rateLimiter: {
      totalPerMinute: 15,
      typePerMinute: {
        STATUS_CHANGE: 6,
        DELETE_NOTIFICATION: 3,
        INVITE: 12,
        LIST_FRIENDS: 15,
        POLL_USER: 1,
        LIST_AVATARS_FAVOURITE: 10,
        LIST_AVATARS_UPLOADED: 15,
        SELECT_AVATAR: 6,
        LIST_INVITE_MESSAGES: 8,
        UPDATE_INVITE_MESSAGE: 12,
        DECLINE_INVITE_OR_INVITE_REQUEST: 12,
        REPRESENT_GROUP: 12,
        LIST_GROUPS: 12,
      },
    },
  });
  private readonly fetchingFriendsSubject = new BehaviorSubject(false);
  private friendFetch?: Promise<LimitedUserFriend[]>;
  private avatarFetch?: Promise<AvatarEx[]>;
  private readonly friendsCache = new CachedValue<LimitedUserFriend[]>(
    undefined,
    RESOURCE_CACHE_TTL,
    'VRCHAT_FRIENDS'
  );
  private readonly groupsCache = new CachedValue<LimitedUserGroups[]>(
    undefined,
    RESOURCE_CACHE_TTL,
    'VRCHAT_GROUPS'
  );
  private readonly avatarCache = new CachedValue<AvatarEx[]>(
    undefined,
    RESOURCE_CACHE_TTL,
    'VRCHAT_AVATARS'
  );
  private readonly inviteMessageCaches: Record<InviteMessageType, CachedValue<InviteMessageEx[]>> =
    {
      [InviteMessageType.Message]: new CachedValue<InviteMessageEx[]>(
        undefined,
        RESOURCE_CACHE_TTL,
        'VRCHAT_INVITE_MESSAGE'
      ),
      [InviteMessageType.Response]: new CachedValue<InviteMessageEx[]>(
        undefined,
        RESOURCE_CACHE_TTL,
        'VRCHAT_INVITE_MESSAGE_RESPONSE'
      ),
      [InviteMessageType.Request]: new CachedValue<InviteMessageEx[]>(
        undefined,
        RESOURCE_CACHE_TTL,
        'VRCHAT_INVITE_MESSAGE_REQUEST'
      ),
      [InviteMessageType.RequestResponse]: new CachedValue<InviteMessageEx[]>(
        undefined,
        RESOURCE_CACHE_TTL,
        'VRCHAT_INVITE_MESSAGE_REQUEST_RESPONSE'
      ),
    };

  public readonly isFetchingFriends = this.fetchingFriendsSubject
    .asObservable()
    .pipe(distinctUntilChanged());

  private user!: Observable<CurrentUser | null>;
  private patchCurrentUser!: (user: Partial<CurrentUser>) => void;

  constructor(
    private readonly settings: Observable<VRChatApiSettings>,
    private readonly updateProfile: (
      profileId: string,
      patch: VRChatProfileSessionPatch
    ) => Promise<void>,
    private readonly reportError: (cause: Error) => void
  ) {}

  public async init(
    user: Observable<CurrentUser | null>,
    patchCurrentUser: (user: Partial<CurrentUser>) => void
  ): Promise<void> {
    this.userAgent = `OyasumiVR/${await getVersion()} (https://github.com/Raphiiko/OyasumiVR)`;
    this.user = user;
    this.patchCurrentUser = patchCurrentUser;
  }

  public async clearCaches(): Promise<void> {
    this.cacheGeneration++;
    this.apiCallQueue.cancelPending(VRCHAT_API_STALE_REQUEST);
    this.activeCacheClears++;
    this.friendFetch = undefined;
    this.avatarFetch = undefined;
    this.fetchingFriendsSubject.next(false);
    try {
      while (this.pendingPersistenceWrites.size) {
        await Promise.allSettled([...this.pendingPersistenceWrites]);
      }
      const results = await Promise.allSettled(
        [
          this.friendsCache,
          this.avatarCache,
          this.groupsCache,
          ...Object.values(this.inviteMessageCaches),
        ].map((cache) => cache.clear())
      );
      for (const result of results) {
        if (result.status === 'rejected') error(`[VRChat] Failed to clear cache: ${result.reason}`);
      }
    } finally {
      this.activeCacheClears--;
    }
  }

  // authentication and user state

  public async setStatus(
    status: UserStatus | null,
    statusMessage: string | null
  ): Promise<boolean> {
    const cacheGeneration = this.cacheGeneration;
    const currentUser = await this.requireCurrentUser('setting status');
    statusMessage =
      statusMessage === null ? null : statusMessage.replace(/\s+/g, ' ').trim().slice(0, 32);
    const statusChange = status !== null && currentUser.status !== status;
    const statusMessageChange =
      statusMessage !== null && currentUser.statusDescription !== statusMessage;
    if (!statusChange && !statusMessageChange) return false;

    if (status !== null && statusMessage !== null) {
      info(`[VRChat] Changing status to '${statusMessage}' ('${status}')`);
    } else if (status !== null) {
      info(`[VRChat] Changing status to '${status}'`);
    } else if (statusMessage !== null) {
      info(`[VRChat] Changing status message to '${statusMessage}'`);
    }
    try {
      const body: Record<string, string> = {};
      if (status !== null) body['status'] = status;
      if (statusMessage !== null) body['statusDescription'] = statusMessage;
      const result = await this.apiCallQueue.queueTask<Response>(
        {
          typeId: 'STATUS_CHANGE',
          runnable: async () => {
            this.ensureCacheGeneration(cacheGeneration);
            return requestVRChat(`${BASE_URL}/users/${currentUser.id}`, {
              method: 'PUT',
              body: JSON.stringify(body),
              headers: await this.getDefaultHeaders({}, cacheGeneration),
            });
          },
        },
        true
      );
      this.ensureCacheGeneration(cacheGeneration);
      this.requireSuccessfulResponse(result);
      this.patchCurrentUser(body);
    } catch (e) {
      error(`[VRChat] Failed to update status: ${JSON.stringify(e)}`);
      return false;
    }
    return true;
  }

  public async verify2FA(code: string, method: VRChatTwoFactorMethod): Promise<void> {
    const cacheGeneration = this.cacheGeneration;
    const profileId = await this.requireActiveProfileId();
    const headers = await this.getDefaultHeaders({}, cacheGeneration, profileId);
    const response = await requestVRChat(`${BASE_URL}/auth/twofactorauth/${method}/verify`, {
      method: 'POST',
      body: JSON.stringify({ code }),
      headers,
    });
    const responseData: VerifyTwoFactorResponse | undefined = await response
      .json()
      .catch(() => undefined);
    if (responseData?.verified === false) {
      warn(`[VRChat] 2FA Verification failed: Invalid code`);
      throw 'INVALID_CODE';
    }
    if (!response.ok || responseData?.verified !== true) {
      error(
        `[VRChat] Received unexpected response from /auth/twofactorauth/${method}/verify: ${JSON.stringify(
          response
        )}`
      );
      throw 'UNEXPECTED_RESPONSE';
    }
    this.ensureCacheGeneration(cacheGeneration);
    await this.parseResponseCookies(response, cacheGeneration, profileId);
  }

  public async getCurrentUser(options: CurrentUserRequestOptions = {}): Promise<CurrentUser> {
    const { credentials, signal } = options;
    const includeTwoFactorCookie = options.includeTwoFactorCookie ?? !credentials;
    const cacheGeneration = this.cacheGeneration;
    const profileId = await this.requireActiveProfileId();
    const headers = await this.getDefaultHeaders(
      {
        includeAuthCookie: !credentials,
        includeTwoFactorCookie,
      },
      cacheGeneration,
      profileId
    );
    if (credentials) {
      headers['Authorization'] = `Basic ${btoa(
        encodeURIComponent(credentials.username) + ':' + encodeURIComponent(credentials.password)
      )}`;
    }
    const response = await requestVRChat(`${BASE_URL}/auth/user`, {
      headers,
      signal,
    });
    const responseData: CurrentUser | CurrentUserChallenge | CurrentUserErrorResponse | undefined =
      await response.json().catch(() => undefined);
    if (response.status === 401) {
      const message =
        responseData && 'error' in responseData ? (responseData.error?.message ?? '') : '';
      switch (message) {
        case '"It looks like you\'re logging in from somewhere new! Check your email for a message from VRChat."':
          error(`[VRChat] Login failed: Check email`);
          throw 'CHECK_EMAIL';
        case '"Invalid Username/Email or Password"':
          error(`[VRChat] Login failed: Invalid credentials`);
          throw 'INVALID_CREDENTIALS';
        case '"Missing Credentials"':
          throw 'MISSING_CREDENTIALS';
        default:
          error(`[VRChat] Authentication rejected: ${JSON.stringify(response)}`);
          throw 'AUTHENTICATION_REJECTED';
      }
    }
    if (!response.ok) {
      error(`[VRChat] Received unexpected response from /auth/user: ${JSON.stringify(response)}`);
      throw 'UNEXPECTED_RESPONSE';
    }
    if (!responseData || typeof responseData !== 'object') {
      error(`[VRChat] Received invalid response body from /auth/user`);
      throw 'UNEXPECTED_RESPONSE';
    }
    this.ensureCacheGeneration(cacheGeneration);
    await this.parseResponseCookies(response, cacheGeneration, profileId);
    if ('requiresTwoFactorAuth' in responseData) {
      if (!Array.isArray(responseData.requiresTwoFactorAuth)) {
        error(`[VRChat] Received invalid 2FA challenge from /auth/user`);
        throw 'UNEXPECTED_RESPONSE';
      }
      const methods = responseData.requiresTwoFactorAuth.map((method) =>
        String(method).toLowerCase()
      );
      info(
        `[VRChat] 2FA Required for login. (methods=${JSON.stringify(responseData.requiresTwoFactorAuth)})`
      );
      if (methods.includes('totp')) throw '2FA_TOTP_REQUIRED';
      if (methods.includes('emailotp')) throw '2FA_EMAILOTP_REQUIRED';
      error(
        '[VRChat] 2FA Required for login, but no supported method found. Available methods: ' +
          JSON.stringify(responseData.requiresTwoFactorAuth)
      );
      throw 'UNSUPPORTED_2FA_METHOD';
    }
    if (!('id' in responseData) || typeof responseData.id !== 'string') {
      error(`[VRChat] Received invalid user from /auth/user`);
      throw 'UNEXPECTED_RESPONSE';
    }
    const user = responseData as CurrentUser;
    this.ensureCacheGeneration(cacheGeneration);
    return user;
  }

  public async logoutProfile(profileId: string): Promise<void> {
    const cacheGeneration = this.cacheGeneration;
    const settings = await firstValueFrom(this.settings);
    const profile = settings.profiles.find((candidate) => candidate.id === profileId);
    if (!profile?.authCookie) return;
    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), PROFILE_LOGOUT_TIMEOUT);
    const response = await requestVRChat(`${BASE_URL}/logout`, {
      method: 'PUT',
      headers: await this.getDefaultHeaders({}, cacheGeneration, profileId),
      signal: abortController.signal,
    }).finally(() => clearTimeout(timeout));
    this.ensureCacheGeneration(cacheGeneration);
    if (!response.ok) throw response;
  }

  // notifications and invites

  public async deleteNotification(notificationId: string): Promise<void> {
    const cacheGeneration = this.cacheGeneration;
    await this.requireCurrentUser('deleting a notification');
    info(`[VRChat] Deleting notification '${notificationId}'`);
    try {
      const result = await this.apiCallQueue.queueTask<Response>({
        typeId: 'DELETE_NOTIFICATION',
        runnable: async () => {
          this.ensureCacheGeneration(cacheGeneration);
          return requestVRChat(`${BASE_URL}/auth/user/notifications/${notificationId}/hide`, {
            method: 'PUT',
            headers: await this.getDefaultHeaders({}, cacheGeneration),
          });
        },
      });
      this.ensureCacheGeneration(cacheGeneration);
      this.requireSuccessfulResponse(result);
    } catch (e) {
      error(`[VRChat] Failed to delete notification: ${JSON.stringify(e)}`);
    }
  }

  public async declineInviteOrInviteRequest(
    notificationId: string,
    notificationType: 'invite' | 'requestInvite',
    message: string
  ): Promise<void> {
    const cacheGeneration = this.cacheGeneration;
    await this.requireCurrentUser('declining an invite or invite request');
    let messageSlot: number | undefined;
    if (message) {
      const messageEx = await this.ensureInviteMessage(
        notificationType === 'invite' ? 'response' : 'requestResponse',
        message
      ).catch((e) => {
        error(`[VRChat] Sending invite without message, failed to allocate message slot: ${e}`);
        return null;
      });
      if (messageEx) messageSlot = messageEx.slot;
      else error(`[VRChat] Sending invite without message, failed to allocate message slot.`);
    }
    try {
      const result = await this.apiCallQueue.queueTask<Response>({
        typeId: 'DECLINE_INVITE_OR_INVITE_REQUEST',
        runnable: async () => {
          this.ensureCacheGeneration(cacheGeneration);
          return requestVRChat(`${BASE_URL}/invite/${notificationId}/response`, {
            method: 'POST',
            headers: await this.getDefaultHeaders({}, cacheGeneration),
            body: JSON.stringify({ responseSlot: messageSlot }),
          });
        },
      });
      this.ensureCacheGeneration(cacheGeneration);
      this.requireSuccessfulResponse(result);
    } catch (e) {
      error(`[VRChat] Failed to decline invite or invite request: ${JSON.stringify(e)}`);
    }
  }

  public async inviteUser(inviteeId: string, instanceId: string, message?: string): Promise<void> {
    const cacheGeneration = this.cacheGeneration;
    await this.requireCurrentUser('inviting a user');
    let messageSlot: number | undefined;
    if (message) {
      const messageEx = await this.ensureInviteMessage('message', message).catch((e) => {
        error(`[VRChat] Sending invite without message, failed to allocate message slot: ${e}`);
        return null;
      });
      if (messageEx) messageSlot = messageEx.slot;
      else error(`[VRChat] Sending invite without message, failed to allocate message slot.`);
    }
    try {
      const result = await this.apiCallQueue.queueTask<Response>({
        typeId: 'INVITE',
        runnable: async () => {
          this.ensureCacheGeneration(cacheGeneration);
          return requestVRChat(`${BASE_URL}/invite/${inviteeId}`, {
            body: JSON.stringify({ instanceId, messageSlot }),
            method: 'POST',
            headers: await this.getDefaultHeaders({}, cacheGeneration),
          });
        },
      });
      this.ensureCacheGeneration(cacheGeneration);
      this.requireSuccessfulResponse(result);
    } catch (e) {
      const failure = requestFailure('VRChat invite request failed', e);
      error(`[VRChat] ${failure.message}`);
      this.reportError(failure);
      throw e;
    }
  }

  public async ensureInviteMessage(
    type: InviteMessageType,
    message: string
  ): Promise<InviteMessageEx | null> {
    const cacheGeneration = this.cacheGeneration;
    const userId = (await this.requireCurrentUser('ensuring an invite message')).id;
    this.ensureCacheGeneration(cacheGeneration);
    message = message.trim().replace(/\s+/g, ' ').slice(0, 64);
    const cache = this.inviteMessageCaches[type];
    let messages = cache.get() ?? (await this.loadInviteMessages(userId, type, cacheGeneration));
    const existingMessage = messages.find((entry) => entry.message === message);
    if (existingMessage) return existingMessage;

    const slot = [...messages]
      .sort((a, b) => b.slot - a.slot)
      .find((entry) => Date.now() >= entry.canUpdateAtTimeStamp);
    if (!slot) return null;

    messages = await this.updateInviteMessage(userId, type, slot.slot, message, cacheGeneration);
    return messages.find((entry) => entry.slot === slot.slot) ?? null;
  }

  // friends, groups, and avatars

  public async listFriends(force = false): Promise<LimitedUserFriend[]> {
    const cacheGeneration = this.cacheGeneration;
    if (!force) {
      const cachedFriends = this.friendsCache.get();
      if (cachedFriends) return cachedFriends;
    }
    await this.requireCurrentUser('listing friends');
    this.ensureCacheGeneration(cacheGeneration);
    if (this.friendFetch) {
      await this.friendFetch;
      this.ensureCacheGeneration(cacheGeneration);
      return this.friendsCache.get() ?? [];
    }

    const friendFetch = this.fetchFriends(cacheGeneration);
    this.friendFetch = friendFetch;
    this.fetchingFriendsSubject.next(true);
    try {
      return await friendFetch;
    } finally {
      if (this.friendFetch === friendFetch) {
        this.friendFetch = undefined;
        this.fetchingFriendsSubject.next(false);
      }
    }
  }

  private async fetchFriends(cacheGeneration: number): Promise<LimitedUserFriend[]> {
    const friends: LimitedUserFriend[] = [];
    try {
      for (const offline of ['false', 'true']) {
        const response = await this.fetchPaginatedData<LimitedUserFriend>(
          {
            url: `${BASE_URL}/auth/user/friends`,
            apiCallTypeId: 'LIST_FRIENDS',
            query: {
              offline,
            },
            maxEntries: MAX_VRCHAT_FRIENDS,
          },
          cacheGeneration
        );
        friends.push(...response);
      }
    } catch (cause) {
      this.ensureCacheGeneration(cacheGeneration);
      error('[VRChat] Failed to list friends: ' + JSON.stringify(cause));
      throw cause;
    }

    this.ensureCacheGeneration(cacheGeneration);
    await this.setCache(this.friendsCache, friends);
    this.ensureCacheGeneration(cacheGeneration);
    return friends;
  }

  public async representGroup(groupId: string, representing: boolean): Promise<void> {
    const cacheGeneration = this.cacheGeneration;
    await this.requireCurrentUser('representing a group');

    const result = await this.apiCallQueue.queueTask<Response>({
      typeId: 'REPRESENT_GROUP',
      runnable: async () => {
        this.ensureCacheGeneration(cacheGeneration);
        return requestVRChat(`${BASE_URL}/groups/${groupId}/representation`, {
          method: 'PUT',
          headers: await this.getDefaultHeaders({}, cacheGeneration),
          body: JSON.stringify({
            isRepresenting: representing,
          }),
        });
      },
    });
    this.ensureCacheGeneration(cacheGeneration);
    this.requireSuccessfulResponse(result);
  }

  public async getUserGroups(force = false): Promise<LimitedUserGroups[]> {
    const cacheGeneration = this.cacheGeneration;
    if (!force) {
      const cachedGroups = this.groupsCache.get();
      if (cachedGroups) return cachedGroups;
    }
    const userId = (await this.requireCurrentUser('getting user groups')).id;
    this.ensureCacheGeneration(cacheGeneration);
    try {
      const result = await this.apiCallQueue.queueTask<Response>({
        typeId: 'LIST_GROUPS',
        runnable: async () => {
          this.ensureCacheGeneration(cacheGeneration);
          return requestVRChat(`${BASE_URL}/users/${userId}/groups`, {
            headers: await this.getDefaultHeaders({}, cacheGeneration),
          });
        },
      });
      const response = this.requireSuccessfulResponse(result);
      const data: LimitedUserGroups[] = await response.json();
      this.ensureCacheGeneration(cacheGeneration);
      await this.setCache(this.groupsCache, data);
      this.ensureCacheGeneration(cacheGeneration);
      return data;
    } catch (e) {
      error('[VRChat] Failed to list groups: ' + JSON.stringify(e));
      throw e;
    }
  }

  public async selectAvatar(avatarId: string): Promise<void> {
    const cacheGeneration = this.cacheGeneration;
    await this.requireCurrentUser('selecting an avatar');
    const result = await this.apiCallQueue.queueTask<Response>({
      typeId: 'SELECT_AVATAR',
      runnable: async () => {
        this.ensureCacheGeneration(cacheGeneration);
        return requestVRChat(`${BASE_URL}/avatars/${avatarId}/select`, {
          method: 'PUT',
          body: JSON.stringify({}),
          headers: await this.getDefaultHeaders({}, cacheGeneration),
        });
      },
    });
    this.ensureCacheGeneration(cacheGeneration);
    this.requireSuccessfulResponse(result);
  }

  public async listAvatars(force = false): Promise<AvatarEx[]> {
    const cacheGeneration = this.cacheGeneration;
    if (!force) {
      const cachedAvatars = this.avatarCache.get();
      if (cachedAvatars) return cachedAvatars;
    }
    await this.requireCurrentUser('listing avatars');
    this.ensureCacheGeneration(cacheGeneration);
    if (this.avatarFetch) {
      await this.avatarFetch;
      this.ensureCacheGeneration(cacheGeneration);
      return this.avatarCache.get() ?? [];
    }

    const avatarFetch = this.fetchAvatars(cacheGeneration);
    this.avatarFetch = avatarFetch;
    try {
      return await avatarFetch;
    } finally {
      if (this.avatarFetch === avatarFetch) this.avatarFetch = undefined;
    }
  }

  private async fetchAvatars(cacheGeneration: number): Promise<AvatarEx[]> {
    let avatars: AvatarEx[] = [];
    try {
      const ownAvatars = await this.fetchPaginatedData<AvatarEx>(
        {
          url: `${BASE_URL}/avatars`,
          apiCallTypeId: 'LIST_AVATARS_UPLOADED',
          query: {
            user: 'me',
            releaseStatus: 'all',
            sort: 'updated',
            order: 'descending',
          },
          maxEntries: MAX_UPLOADED_AVATARS,
        },
        cacheGeneration
      );
      avatars.push(...ownAvatars);
      const favouriteAvatars = await this.fetchPaginatedData<AvatarEx>(
        {
          url: `${BASE_URL}/avatars/favorites`,
          apiCallTypeId: 'LIST_AVATARS_FAVOURITE',
          query: { sort: 'updated' },
          maxEntries: MAX_FAVOURITE_AVATARS,
        },
        cacheGeneration
      );
      avatars.push(...favouriteAvatars);
    } catch (cause) {
      this.ensureCacheGeneration(cacheGeneration);
      error('[VRChat] Failed to list avatars: ' + JSON.stringify(cause));
      throw cause;
    }

    avatars = uniqBy(avatars, 'id');
    this.ensureCacheGeneration(cacheGeneration);
    await this.setCache(this.avatarCache, avatars);
    this.ensureCacheGeneration(cacheGeneration);
    return avatars;
  }

  // live cache updates

  public pollCurrentUser(): Promise<CompletionResult<CurrentUser>> {
    return this.apiCallQueue.queueTask<CurrentUser>({
      typeId: 'POLL_USER',
      runnable: () => this.getCurrentUser(),
    });
  }

  public updateCachedGroup(groupId: string, group: Partial<LimitedUserGroups>): void {
    if (this.activeCacheClears) return;
    if (group.groupId && group.groupId !== groupId) {
      throw new Error("Called updateCachedGroup with a group that doesn't match the groupId");
    }
    const groups = this.groupsCache.get() ?? [];
    if (!groups.some((entry) => entry.groupId === groupId)) return;

    const updatedGroups = groups.map((entry) => {
      if (entry.groupId === groupId) return { ...entry, ...group };
      return group.isRepresenting ? { ...entry, isRepresenting: false } : entry;
    });
    void this.setCache(this.groupsCache, updatedGroups);
  }

  // request and persistence helpers

  private async requireCurrentUser(action: string): Promise<CurrentUser> {
    const user = await firstValueFrom(this.user);
    if (user) return user;

    const message = `Tried ${action} while not logged in`;
    error(`[VRChat] ${message}`);
    throw new Error(message);
  }

  private requireSuccessfulResponse(result: CompletionResult<Response>): Response {
    if (result.error) throw result.error;
    if (!result.result?.ok) throw result.result;
    return result.result;
  }

  private async loadInviteMessages(
    userId: string,
    type: InviteMessageType,
    cacheGeneration: number
  ): Promise<InviteMessageEx[]> {
    const result = await this.apiCallQueue.queueTask<Response>({
      typeId: 'LIST_INVITE_MESSAGES',
      runnable: async () => {
        this.ensureCacheGeneration(cacheGeneration);
        return requestVRChat(`${BASE_URL}/message/${userId}/${type}`, {
          headers: await this.getDefaultHeaders({}, cacheGeneration),
        });
      },
    });
    const response = this.requireSuccessfulResponse(result);
    return this.cacheInviteMessages(type, await response.json(), cacheGeneration);
  }

  private async updateInviteMessage(
    userId: string,
    type: InviteMessageType,
    slot: number,
    message: string,
    cacheGeneration: number
  ): Promise<InviteMessageEx[]> {
    const result = await this.apiCallQueue.queueTask<Response>({
      typeId: 'UPDATE_INVITE_MESSAGE',
      runnable: async () => {
        this.ensureCacheGeneration(cacheGeneration);
        return requestVRChat(`${BASE_URL}/message/${userId}/${type}/${slot}`, {
          method: 'PUT',
          headers: await this.getDefaultHeaders({}, cacheGeneration),
          body: JSON.stringify({ message }),
        });
      },
    });
    const response = this.requireSuccessfulResponse(result);
    return this.cacheInviteMessages(type, await response.json(), cacheGeneration);
  }

  private async cacheInviteMessages(
    type: InviteMessageType,
    messages: InviteMessage[],
    cacheGeneration: number
  ): Promise<InviteMessageEx[]> {
    this.ensureCacheGeneration(cacheGeneration);
    const entries = messages.map((message) => ({
      type: message.messageType,
      slot: message.slot,
      message: message.message,
      canUpdateAtTimeStamp: Date.now() + Math.max(0, message.remainingCooldownMinutes * 60_000),
    }));
    await this.setCache(this.inviteMessageCaches[type], entries);
    this.ensureCacheGeneration(cacheGeneration);
    return entries;
  }

  private async fetchPaginatedData<T>(
    options: PaginatedRequestOptions,
    cacheGeneration?: number
  ): Promise<T[]> {
    const requestGeneration = cacheGeneration ?? this.cacheGeneration;
    const { url, apiCallTypeId, query = {}, maxEntries = DEFAULT_PAGE_LIMIT } = options;
    const maxRetries = options.rateLimit?.maxRetries ?? DEFAULT_RATE_LIMIT_RETRIES;
    const retryDelay = options.rateLimit?.delay ?? DEFAULT_RATE_LIMIT_DELAY;
    const entries: T[] = [];
    let rateLimitRetries = 0;
    for (let offset = 0; offset < maxEntries;) {
      if (cacheGeneration !== undefined) this.ensureCacheGeneration(cacheGeneration);
      const response = await this.apiCallQueue.queueTask<Response>({
        typeId: apiCallTypeId,
        runnable: async () => {
          if (cacheGeneration !== undefined) this.ensureCacheGeneration(cacheGeneration);
          const queryParams = new URLSearchParams({
            offset: offset.toString(),
            n: String(PAGE_SIZE),
            ...query,
          }).toString();
          return requestVRChat(`${url}?${queryParams}`, {
            headers: await this.getDefaultHeaders({}, requestGeneration),
          });
        },
      });
      if (cacheGeneration !== undefined) this.ensureCacheGeneration(cacheGeneration);

      if (response.result?.status === 429) {
        if (rateLimitRetries >= maxRetries) {
          throw new Error(`Paginated request was rate limited (429) more than ${maxRetries} times`);
        }
        rateLimitRetries++;
        await new Promise((resolve) => setTimeout(resolve, retryDelay));
        continue;
      }

      if (!response.result?.ok) {
        throw new Error(
          'Received unexpected response: ' +
            (response.result
              ? JSON.stringify({
                  status: response.result.status,
                  data: response.result.body,
                  error: response.error,
                })
              : 'No Response: ' + response.error)
        );
      }

      const data: T[] = await response.result.json();
      entries.push(...data);
      if (!data.length) break;
      offset += PAGE_SIZE;
    }
    return entries;
  }

  /** Adds persisted auth cookies because the HTTP client has no cookie store. */
  private async getDefaultHeaders(
    options: RequestHeaderOptions,
    cacheGeneration: number,
    profileId?: string
  ): Promise<Record<string, string>> {
    const {
      contentType = 'application/json',
      includeAuthCookie = true,
      includeTwoFactorCookie = true,
    } = options;
    const settings = await firstValueFrom(this.settings);
    this.ensureCacheGeneration(cacheGeneration);
    const profile = profileId
      ? settings.profiles.find((candidate) => candidate.id === profileId)
      : getActiveVRChatProfile(settings);
    if (!profile) throw new Error('Cannot make a VRChat API request without an active profile');
    const cookies: string[] = [];
    if (includeAuthCookie && profile.authCookie)
      cookies.push(serializeCookie({ name: 'auth', value: profile.authCookie }));
    if (includeTwoFactorCookie && profile.twoFactorCookie)
      cookies.push(serializeCookie({ name: 'twoFactorAuth', value: profile.twoFactorCookie }));
    return {
      Cookie: cookies.join('; '),
      'User-Agent': this.userAgent,
      'Content-Type': contentType,
    };
  }

  private async setCache<T>(cache: CachedValue<T>, value: T): Promise<void> {
    try {
      await this.trackWrite(cache.set(value));
    } catch (e) {
      error(`[VRChat] Failed to persist cache: ${e}`);
    }
  }

  private async trackWrite<T>(write: Promise<T>): Promise<T> {
    this.pendingPersistenceWrites.add(write);
    try {
      return await write;
    } finally {
      this.pendingPersistenceWrites.delete(write);
    }
  }

  private ensureCacheGeneration(generation: number): void {
    if (generation !== this.cacheGeneration) throw VRCHAT_API_STALE_REQUEST;
  }

  private async requireActiveProfileId(): Promise<string> {
    const profile = getActiveVRChatProfile(await firstValueFrom(this.settings));
    if (!profile) throw new Error('Cannot make a VRChat API request without an active profile');
    return profile.id;
  }

  private async parseResponseCookies(
    response: Response,
    cacheGeneration: number,
    profileId: string
  ): Promise<void> {
    const patch: VRChatProfileSessionPatch = {};
    const cookieHeaders = response.headers.getSetCookie();
    for (const cookieHeader of cookieHeaders) {
      const cookies = parseSetCookieHeader(cookieHeader);
      for (const cookie of cookies) {
        switch (cookie.name) {
          case 'auth':
            patch.authCookie = cookie.value;
            break;
          case 'twoFactorAuth':
            patch.twoFactorCookie = cookie.value;
            break;
        }
      }
    }
    if (!Object.keys(patch).length) return;
    this.ensureCacheGeneration(cacheGeneration);
    await this.trackWrite(this.updateProfile(profileId, patch));
    this.ensureCacheGeneration(cacheGeneration);
  }
}

function requestFailure(message: string, cause: unknown): Error {
  if (cause instanceof Response) return new Error(`${message}: HTTP ${cause.status}`);
  if (cause instanceof Error) return new Error(message);
  return new Error(`${message}: unknown error`);
}
