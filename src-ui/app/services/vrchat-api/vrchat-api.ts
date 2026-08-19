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
import { BehaviorSubject, firstValueFrom, map, Observable, Subject } from 'rxjs';
import { VRChatApiSettings } from 'src-ui/app/models/vrchat-api-settings';
import { CompletionResult } from 'src-ui/app/utils/completer';

async function fetch(
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

export const VRCHAT_API_STALE_REQUEST = 'STALE_REQUEST';

export type VRChatTwoFactorMethod = 'totp' | 'emailotp';

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
  private cacheGeneration = 0;
  private cacheClearsInFlight = 0;
  private pendingWrites = new Set<Promise<unknown>>();
  private apiCallQueue: TaskQueue = new TaskQueue({
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
  private _friendFetcher = new BehaviorSubject<Observable<'SUCCESS' | 'FAILED'> | null>(null);
  private _avatarFetcher = new BehaviorSubject<Observable<'SUCCESS' | 'FAILED'> | null>(null);
  private _currentUserCache: CachedValue<CurrentUser> = new CachedValue<CurrentUser>(
    undefined,
    5 * 60 * 1000, // Cache for 5 minutes
    'VRCHAT_CURRENT_USER'
  );
  private _friendsCache: CachedValue<LimitedUserFriend[]> = new CachedValue<LimitedUserFriend[]>(
    undefined,
    60 * 60 * 1000, // Cache for 1 hour
    'VRCHAT_FRIENDS'
  );
  private _groupsCache: CachedValue<LimitedUserGroups[]> = new CachedValue<LimitedUserGroups[]>(
    undefined,
    60 * 60 * 1000, // Cache for 1 hour
    'VRCHAT_GROUPS'
  );
  private _avatarCache: CachedValue<AvatarEx[]> = new CachedValue<AvatarEx[]>(
    undefined,
    60 * 60 * 1000, // Cache for 1 hour
    'VRCHAT_AVATARS'
  );
  private _inviteMessageCaches: Record<InviteMessageType, CachedValue<InviteMessageEx[]>> = {
    [InviteMessageType.Message]: new CachedValue<InviteMessageEx[]>(
      undefined,
      60 * 60 * 1000, // Cache for 1 hour
      'VRCHAT_INVITE_MESSAGE'
    ),
    [InviteMessageType.Response]: new CachedValue<InviteMessageEx[]>(
      undefined,
      60 * 60 * 1000, // Cache for 1 hour
      'VRCHAT_INVITE_MESSAGE_RESPONSE'
    ),
    [InviteMessageType.Request]: new CachedValue<InviteMessageEx[]>(
      undefined,
      60 * 60 * 1000, // Cache for 1 hour
      'VRCHAT_INVITE_MESSAGE_REQUEST'
    ),
    [InviteMessageType.RequestResponse]: new CachedValue<InviteMessageEx[]>(
      undefined,
      60 * 60 * 1000, // Cache for 1 hour
      'VRCHAT_INVITE_MESSAGE_REQUEST_RESPONSE'
    ),
  };

  public isFetchingFriends = this._friendFetcher.asObservable().pipe(map(Boolean));

  private user!: Observable<CurrentUser | null>;
  private patchCurrentUser!: (user: Partial<CurrentUser>) => void;

  constructor(
    private settings: Observable<VRChatApiSettings>,
    private updateSettings: (settings: Partial<VRChatApiSettings>) => Promise<void>
  ) {}

  public async init(
    user: Observable<CurrentUser | null>,
    patchCurrentUser: (user: Partial<CurrentUser>) => void
  ) {
    this.userAgent = `OyasumiVR/${await getVersion()} (https://github.com/Raphiiko/OyasumiVR)`;
    this.user = user;
    this.patchCurrentUser = patchCurrentUser;
  }

  public async clearCaches() {
    this.cacheGeneration++;
    this.cacheClearsInFlight++;
    this._friendFetcher.next(null);
    this._avatarFetcher.next(null);
    try {
      while (this.pendingWrites.size) await Promise.allSettled([...this.pendingWrites]);
      const results = await Promise.allSettled(
        [
          this._currentUserCache,
          this._friendsCache,
          this._avatarCache,
          this._groupsCache,
          ...Object.values(this._inviteMessageCaches),
        ].map(async (cache) => await cache.clear())
      );
      for (const result of results) {
        if (result.status === 'rejected') error(`[VRChat] Failed to clear cache: ${result.reason}`);
      }
    } finally {
      this.cacheClearsInFlight--;
    }
  }

  async setStatus(status: UserStatus | null, statusMessage: string | null): Promise<boolean> {
    // Throw if we don't have a current user
    const userId = (await firstValueFrom(this.user))?.id;
    if (!userId) {
      error(`[VRChat] Tried setting status while not logged in`);
      throw new Error('Tried setting status while not logged in');
    }
    // Sanitize status message if needed
    statusMessage =
      statusMessage === null ? null : statusMessage.replace(/\s+/g, ' ').trim().slice(0, 32);
    const statusChange = status !== null && (await firstValueFrom(this.user))?.status !== status;
    const statusMessageChange =
      statusMessage !== null &&
      (await firstValueFrom(this.user))?.statusDescription !== statusMessage;
    // Don't do anything if there would be no changes
    if (!statusChange && !statusMessageChange) return false;
    // Log status change
    if (status !== null && statusMessage !== null) {
      info(`[VRChat] Changing status to '${statusMessage}' ('${status}')`);
    } else if (status !== null) {
      info(`[VRChat] Changing status to '${status}'`);
    } else if (statusMessage !== null) {
      info(`[VRChat] Changing status message to '${statusMessage}'`);
    }
    // Send status change request
    try {
      const body: Record<string, string> = {};
      if (status !== null) body['status'] = status;
      if (statusMessage !== null) body['statusDescription'] = statusMessage;
      const result = await this.apiCallQueue.queueTask<Response>(
        {
          typeId: 'STATUS_CHANGE',
          runnable: async () => {
            return fetch(`${BASE_URL}/users/${userId}`, {
              method: 'PUT',
              body: JSON.stringify(body),
              headers: await this.getDefaultHeaders(),
            });
          },
        },
        true
      );
      if (result.result && result.result.ok) this.patchCurrentUser(body);
      if (result.error) throw result.error;
      if (!result.result?.ok) throw result.result;
    } catch (e) {
      error(`[VRChat] Failed to update status: ${JSON.stringify(e)}`);
      return false;
    }
    return true;
  }

  public async verify2FA(code: string, method: VRChatTwoFactorMethod) {
    const cacheGeneration = this.cacheGeneration;
    const headers = await this.getDefaultHeaders();
    const response = await fetch(`${BASE_URL}/auth/twofactorauth/${method}/verify`, {
      method: 'POST',
      body: JSON.stringify({ code }),
      headers,
    });
    const responseData = await response.json().catch(() => {});
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
    await this.parseResponseCookies(response, cacheGeneration);
  }

  public async getCurrentUser(
    credentials?: {
      username: string;
      password: string;
    },
    force = false,
    signal?: AbortSignal
  ): Promise<CurrentUser> {
    const cacheGeneration = this.cacheGeneration;
    const headers: Record<string, string> = {
      ...(await this.getDefaultHeaders('application/json', !credentials)),
    };
    if (credentials) {
      force = true;
      headers['Authorization'] = `Basic ${btoa(
        encodeURIComponent(credentials.username) + ':' + encodeURIComponent(credentials.password)
      )}`;
    }
    if (!force) {
      const user = this._currentUserCache.get();
      if (user) {
        info(`[VRChat] Loaded user from cache`);
        return user;
      }
    }
    const response = await fetch(`${BASE_URL}/auth/user`, {
      headers,
      signal,
    });
    const responseData: CurrentUser | { requiresTwoFactorAuth: string[] } | undefined =
      await response.json().catch(() => {});
    if (response.status === 401) {
      const message: string = (responseData as any)?.error?.message ?? '';
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
          throw credentials ? 'INVALID_CREDENTIALS' : 'MISSING_CREDENTIALS';
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
    await this.parseResponseCookies(response, cacheGeneration);
    if ('requiresTwoFactorAuth' in responseData) {
      const data = responseData as { requiresTwoFactorAuth: string[] };
      if (!Array.isArray(data.requiresTwoFactorAuth)) {
        error(`[VRChat] Received invalid 2FA challenge from /auth/user`);
        throw 'UNEXPECTED_RESPONSE';
      }
      const methods = data.requiresTwoFactorAuth.map((method) => String(method).toLowerCase());
      info(
        `[VRChat] 2FA Required for login. (methods=${JSON.stringify(data.requiresTwoFactorAuth)})`
      );
      if (methods.includes('totp')) throw '2FA_TOTP_REQUIRED';
      if (methods.includes('emailotp')) throw '2FA_EMAILOTP_REQUIRED';
      error(
        '[VRChat] 2FA Required for login, but no supported method found. Available methods: ' +
          JSON.stringify(data.requiresTwoFactorAuth)
      );
      throw 'UNSUPPORTED_2FA_METHOD';
    }
    const user = responseData as CurrentUser;
    this.ensureCacheGeneration(cacheGeneration);
    await this.setCache(this._currentUserCache, user);
    this.ensureCacheGeneration(cacheGeneration);
    return user;
  }

  public async deleteNotification(notificationId: string) {
    // Throw if we don't have a current user
    const userId = (await firstValueFrom(this.user))?.id;
    if (!userId) {
      error('[VRChat] Tried deleting a notification while not logged in');
      throw new Error('Tried deleting a notification while not logged in');
    }
    // Send
    info(`[VRChat] Deleting notification 'notificationId'`);
    try {
      const result = await this.apiCallQueue.queueTask<Response>({
        typeId: 'DELETE_NOTIFICATION',
        runnable: async () => {
          return fetch(`${BASE_URL}/auth/user/notifications/${notificationId}/hide`, {
            method: 'PUT',
            headers: await this.getDefaultHeaders(),
          });
        },
      });
      if (result.error) throw result.error;
      if (!result.result?.ok) throw result.result;
    } catch (e) {
      error(`[VRChat] Failed to delete notification: ${JSON.stringify(e)}`);
    }
  }

  public async declineInviteOrInviteRequest(
    notificationId: string,
    notificationType: 'invite' | 'requestInvite',
    message: string
  ) {
    // Throw if we don't have a current user
    const userId = (await firstValueFrom(this.user))?.id;
    if (!userId) {
      error('[VRChat] Tried declining an invite or invite request while not logged in');
      throw new Error('Tried declining an invite or invite request while not logged in');
    }
    // Get the message slot if provided
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
    // Send the message
    try {
      const result = await this.apiCallQueue.queueTask<Response>({
        typeId: 'DECLINE_INVITE_OR_INVITE_REQUEST',
        runnable: async () => {
          return await fetch(`${BASE_URL}/invite/${notificationId}/response`, {
            method: 'POST',
            headers: await this.getDefaultHeaders(),
            body: JSON.stringify({ responseSlot: messageSlot }),
          });
        },
      });
      if (result.error) throw result.error;
      if (!result.result?.ok) throw result.result;
    } catch (e) {
      error(`[VRChat] Failed to delete notification: ${JSON.stringify(e)}`);
    }
  }

  public async inviteUser(inviteeId: string, instanceId: string, message?: string) {
    // Throw if we don't have a current user
    const userId = (await firstValueFrom(this.user))?.id;
    if (!userId) {
      error('[VRChat] Tried inviting a user while not logged in');
      throw new Error('Tried inviting a user while not logged in');
    }
    // Get the message slot if provided
    let messageSlot: number | undefined;
    if (message) {
      const messageEx = await this.ensureInviteMessage('message', message).catch((e) => {
        error(`[VRChat] Sending invite without message, failed to allocate message slot: ${e}`);
        return null;
      });
      if (messageEx) messageSlot = messageEx.slot;
      else error(`[VRChat] Sending invite without message, failed to allocate message slot.`);
    }
    // Send
    try {
      await this.apiCallQueue.queueTask<Response>({
        typeId: 'INVITE',
        runnable: async () => {
          return fetch(`${BASE_URL}/invite/${inviteeId}`, {
            body: JSON.stringify({ instanceId, messageSlot }),
            method: 'POST',
            headers: await this.getDefaultHeaders(),
          });
        },
      });
    } catch (e) {
      error(`[VRChat] Failed to invite user: ${JSON.stringify(e)}`);
      throw e;
    }
  }

  public async ensureInviteMessage(
    type: InviteMessageType,
    message: string
  ): Promise<InviteMessageEx | null> {
    const cacheGeneration = this.cacheGeneration;
    const userId = (await firstValueFrom(this.user))?.id;
    if (!userId) {
      error('[VRChat] Tried ensuring an invite message while not logged in');
      throw new Error('Tried ensuring an invite message while not logged in');
    }
    this.ensureCacheGeneration(cacheGeneration);
    message = message.trim().replace(/\s+/g, ' ').slice(0, 64);
    // load message slots
    const cache = this._inviteMessageCaches[type];
    let messages: InviteMessageEx[] | undefined = cache.get();
    if (!messages) {
      const result = await this.apiCallQueue.queueTask<Response>({
        typeId: 'LIST_INVITE_MESSAGES',
        runnable: async () => {
          this.ensureCacheGeneration(cacheGeneration);
          return await fetch(`${BASE_URL}/message/${userId}/${type}`, {
            headers: await this.getDefaultHeaders(),
          });
        },
      });
      if (result.error) throw result.error;
      if (!result.result?.ok) throw result.result;
      const data = await result.result.json();
      this.ensureCacheGeneration(cacheGeneration);
      messages = data.map(
        (message: InviteMessage) =>
          ({
            type: message.messageType,
            slot: message.slot,
            message: message.message,
            canUpdateAtTimeStamp:
              Date.now() + Math.max(0, message.remainingCooldownMinutes * 60 * 1000),
          }) as InviteMessageEx
      );
      if (cacheGeneration === this.cacheGeneration) {
        await this.setCache(cache, messages!);
        this.ensureCacheGeneration(cacheGeneration);
      }
    }
    let slot = messages!.find((m) => m.message === message);
    if (slot) return slot;
    // find a reusable slot
    messages!.sort((a, b) => b.slot - a.slot);
    slot = messages!.find((m) => Date.now() >= m.canUpdateAtTimeStamp);
    if (!slot) return null;
    // update the slot
    const result = await this.apiCallQueue.queueTask<Response>({
      typeId: 'UPDATE_INVITE_MESSAGE',
      runnable: async () => {
        this.ensureCacheGeneration(cacheGeneration);
        return await fetch(`${BASE_URL}/message/${userId}/${type}/${slot.slot}`, {
          method: 'PUT',
          headers: await this.getDefaultHeaders(),
          body: JSON.stringify({ message }),
        });
      },
    });
    if (result.error) throw result.error;
    if (!result.result?.ok) throw result.result;
    const data = await result.result.json();
    this.ensureCacheGeneration(cacheGeneration);
    messages = data.map(
      (message: InviteMessage) =>
        ({
          type: message.messageType,
          slot: message.slot,
          message: message.message,
          canUpdateAtTimeStamp:
            Date.now() + Math.max(0, message.remainingCooldownMinutes * 60 * 1000),
        }) as InviteMessageEx
    );
    if (cacheGeneration === this.cacheGeneration) {
      await this.setCache(cache, messages!);
      this.ensureCacheGeneration(cacheGeneration);
    }

    return messages?.find((m) => m.slot === slot.slot) ?? null;
  }

  public async listFriends(force = false): Promise<LimitedUserFriend[]> {
    const cacheGeneration = this.cacheGeneration;
    if (!force) {
      const cachedFriends = this._friendsCache.get();
      if (cachedFriends) return cachedFriends;
    }
    const userId = (await firstValueFrom(this.user))?.id;
    if (!userId) {
      error('[VRChat] Tried listing friends while not logged in');
      throw new Error('Tried listing friends while not logged in');
    }
    this.ensureCacheGeneration(cacheGeneration);
    if (this._friendFetcher.value) {
      await firstValueFrom(this._friendFetcher.value);
      this.ensureCacheGeneration(cacheGeneration);
      return this._friendsCache.get() ?? [];
    }
    const friendFetchCompletion = new Subject<'SUCCESS' | 'FAILED'>();
    const friendFetch = friendFetchCompletion.asObservable();
    this._friendFetcher.next(friendFetch);
    const friends: LimitedUserFriend[] = [];
    let fetchResult: 'SUCCESS' | 'FAILED' = 'FAILED';
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
        fetchResult = 'SUCCESS';
        friends.push(...response);
      }
    } catch (e) {
      error('[VRChat] Failed to list friends: ' + JSON.stringify(e));
      fetchResult = 'FAILED';
    }
    if (cacheGeneration !== this.cacheGeneration) {
      friendFetchCompletion.next('FAILED');
      if (this._friendFetcher.value === friendFetch) this._friendFetcher.next(null);
      throw VRCHAT_API_STALE_REQUEST;
    }
    if (fetchResult === 'SUCCESS' && cacheGeneration === this.cacheGeneration) {
      await this.setCache(this._friendsCache, friends);
    }
    if (cacheGeneration !== this.cacheGeneration) {
      friendFetchCompletion.next('FAILED');
      if (this._friendFetcher.value === friendFetch) this._friendFetcher.next(null);
      throw VRCHAT_API_STALE_REQUEST;
    }
    friendFetchCompletion.next(fetchResult);
    if (this._friendFetcher.value === friendFetch) this._friendFetcher.next(null);
    return friends;
  }

  public async representGroup(groupId: string, representing: boolean) {
    const userId = (await firstValueFrom(this.user))?.id;
    if (!userId) {
      error('[VRChat] Tried representing a group while not logged in');
      throw new Error('Tried representing a group while not logged in');
    }

    await this.apiCallQueue.queueTask({
      typeId: 'REPRESENT_GROUP',
      runnable: async () => {
        return fetch(`${BASE_URL}/groups/${groupId}/representation`, {
          method: 'PUT',
          headers: await this.getDefaultHeaders(),
          body: JSON.stringify({
            isRepresenting: representing,
          }),
        });
      },
    });
  }

  public async getUserGroups(force = false): Promise<LimitedUserGroups[]> {
    const cacheGeneration = this.cacheGeneration;
    if (!force) {
      const cachedGroups = this._groupsCache.get();
      if (cachedGroups) return cachedGroups;
    }
    const userId = (await firstValueFrom(this.user))?.id;
    if (!userId) {
      error('[VRChat] Tried getting user groups while not logged in');
      throw new Error('Tried getting user groups while not logged in');
    }
    this.ensureCacheGeneration(cacheGeneration);
    try {
      const result = await this.apiCallQueue.queueTask<Response>({
        typeId: 'LIST_GROUPS',
        runnable: async () => {
          this.ensureCacheGeneration(cacheGeneration);
          return await fetch(`${BASE_URL}/users/${userId}/groups`, {
            headers: await this.getDefaultHeaders(),
          });
        },
      });
      if (result.error) throw result.error;
      if (!result.result?.ok) throw result.result;
      const data = await result.result.json();
      this.ensureCacheGeneration(cacheGeneration);
      if (cacheGeneration === this.cacheGeneration) await this.setCache(this._groupsCache, data);
      this.ensureCacheGeneration(cacheGeneration);
      return data;
    } catch (e) {
      error('[VRChat] Failed to list groups: ' + JSON.stringify(e));
      throw e;
    }
  }

  public async selectAvatar(avatarId: string) {
    // Throw if we don't have a current user
    const userId = (await firstValueFrom(this.user))?.id;
    if (!userId) {
      error('[VRChat] Tried selecting an avatar while not logged in');
      throw new Error('Tried selecting an avatar while not logged in');
    }
    // Send
    await this.apiCallQueue.queueTask({
      typeId: 'SELECT_AVATAR',
      runnable: async () => {
        return fetch(`${BASE_URL}/avatars/${avatarId}/select`, {
          method: 'PUT',
          body: JSON.stringify({}),
          headers: await this.getDefaultHeaders(),
        });
      },
    });
  }

  public async listAvatars(force = false): Promise<AvatarEx[]> {
    const cacheGeneration = this.cacheGeneration;
    if (!force) {
      const cachedAvatars = this._avatarCache.get();
      if (cachedAvatars) return cachedAvatars;
    }
    const userId = (await firstValueFrom(this.user))?.id;
    if (!userId) {
      error('[VRChat] Tried listing avatars while not logged in');
      throw new Error('Tried listing avatars while not logged in');
    }
    this.ensureCacheGeneration(cacheGeneration);
    if (this._avatarFetcher.value) {
      await firstValueFrom(this._avatarFetcher.value);
      this.ensureCacheGeneration(cacheGeneration);
      return this._avatarCache.get() ?? [];
    }
    const avatarFetchCompletion = new Subject<'SUCCESS' | 'FAILED'>();
    const avatarFetch = avatarFetchCompletion.asObservable();
    this._avatarFetcher.next(avatarFetch);
    let avatars: AvatarEx[] = [];
    let fetchResult: 'SUCCESS' | 'FAILED' = 'FAILED';
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
      fetchResult = 'SUCCESS';
    } catch (e) {
      error('[VRChat] Failed to list uploaded avatars: ' + JSON.stringify(e));
      fetchResult = 'FAILED';
    }
    if (fetchResult != 'FAILED') {
      try {
        const favAvatars = await this.fetchPaginatedData<AvatarEx>(
          {
            url: `${BASE_URL}/avatars/favorites`,
            apiCallTypeId: 'LIST_AVATARS_FAVOURITE',
            query: {
              sort: 'updated',
            },
            maxEntries: MAX_FAVOURITE_AVATARS,
          },
          cacheGeneration
        );
        avatars.push(...favAvatars);
        fetchResult = 'SUCCESS';
      } catch (e) {
        error('[VRChat] Failed to list favourite avatars: ' + JSON.stringify(e));
        fetchResult = 'FAILED';
      }
    }
    avatars = uniqBy(avatars, 'id');
    if (cacheGeneration !== this.cacheGeneration) {
      avatarFetchCompletion.next('FAILED');
      if (this._avatarFetcher.value === avatarFetch) this._avatarFetcher.next(null);
      throw VRCHAT_API_STALE_REQUEST;
    }
    if (fetchResult === 'SUCCESS' && cacheGeneration === this.cacheGeneration) {
      await this.setCache(this._avatarCache, avatars);
    }
    if (cacheGeneration !== this.cacheGeneration) {
      avatarFetchCompletion.next('FAILED');
      if (this._avatarFetcher.value === avatarFetch) this._avatarFetcher.next(null);
      throw VRCHAT_API_STALE_REQUEST;
    }
    avatarFetchCompletion.next(fetchResult);
    if (this._avatarFetcher.value === avatarFetch) this._avatarFetcher.next(null);
    return avatars;
  }

  public pollCurrentUser(): Promise<CompletionResult<CurrentUser>> {
    return this.apiCallQueue.queueTask<CurrentUser>({
      typeId: 'POLL_USER',
      runnable: () => this.getCurrentUser(undefined, true),
    });
  }

  public updateCachedGroup(groupId: string, group: Partial<LimitedUserGroups>) {
    if (this.cacheClearsInFlight) return;
    if (group.groupId && group.groupId !== groupId) {
      throw new Error("Called updateCachedGroup with a group that doesn't match the groupId");
    }
    const groups = this._groupsCache.get() ?? [];
    const index = groups.findIndex((g) => g.groupId === groupId);
    if (index !== -1) {
      groups[index] = { ...groups[index], ...group };

      // clear other representations
      if (group.isRepresenting) {
        for (const otherGroup of groups) {
          if (otherGroup.groupId !== groupId) {
            otherGroup.isRepresenting = false;
          }
        }
      }

      void this.setCache(this._groupsCache, groups);
    }
  }

  private async fetchPaginatedData<T>(
    _options: {
      url: string;
      apiCallTypeId: string;
      query?: Record<string, string>;
      maxEntries?: number;
      rateLimit?: {
        maxRetries?: number;
        timeout?: number;
      };
    },
    cacheGeneration?: number
  ): Promise<T[]> {
    const options: {
      url: string;
      apiCallTypeId: string;
      query: Record<string, string>;
      maxEntries: number;
      rateLimit: {
        maxRetries: number;
        timeout: number;
      };
    } = Object.assign(
      {
        query: {},
        maxEntries: 500,
        rateLimit: Object.assign(
          {
            maxRetries: 5,
            timeout: 5000,
          },
          _options.rateLimit
        ),
      },
      _options
    );

    const entries: T[] = [];
    let nextOffset = 0;
    let rateLimitRetries = 0;
    for (let offset = 0; offset < options.maxEntries!; offset += nextOffset) {
      if (cacheGeneration !== undefined) this.ensureCacheGeneration(cacheGeneration);
      nextOffset = 100;
      const response = await this.apiCallQueue.queueTask<Response>({
        typeId: options.apiCallTypeId,
        runnable: async () => {
          if (cacheGeneration !== undefined) this.ensureCacheGeneration(cacheGeneration);
          const queryParams = new URLSearchParams({
            offset: offset.toString(),
            n: '100',
            ...options.query,
          }).toString();
          return fetch(`${options.url}?${queryParams}`, {
            headers: await this.getDefaultHeaders(),
          });
        },
      });
      if (cacheGeneration !== undefined) this.ensureCacheGeneration(cacheGeneration);
      // handle rate limiting
      if (response.result?.status === 429) {
        if (rateLimitRetries < options.rateLimit.maxRetries) {
          nextOffset = 0;
          rateLimitRetries++;
          await new Promise((resolve) => setTimeout(resolve, options.rateLimit.timeout));
          continue;
        } else {
          throw new Error(
            'Paginated request was rate limited (429) too many times (' +
              options.rateLimit.maxRetries +
              ')'
          );
        }
      }
      // handle results
      if (response.result?.ok) {
        const data: T[] = await response.result.json();
        entries.push(...data);
        if (data.length > 0) continue;
        break;
      } else {
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
    }
    return entries;
  }

  private async getDefaultHeaders(
    contentType: string = 'application/json',
    includeAuthCookie = true
  ): Promise<Record<string, string>> {
    const settings = await firstValueFrom(this.settings);
    const cookies = [];
    if (includeAuthCookie && settings.authCookie)
      cookies.push(serializeCookie({ name: 'auth', value: settings.authCookie }));
    if (settings.twoFactorCookie)
      cookies.push(serializeCookie({ name: 'twoFactorAuth', value: settings.twoFactorCookie }));
    return {
      Cookie: cookies.join('; '),
      'User-Agent': this.userAgent,
      'Content-Type': contentType,
    };
  }

  private async setCache<T>(cache: CachedValue<T>, value: T) {
    try {
      await this.trackWrite(cache.set(value));
    } catch (e) {
      error(`[VRChat] Failed to persist cache: ${e}`);
    }
  }

  private async trackWrite<T>(write: Promise<T>): Promise<T> {
    this.pendingWrites.add(write);
    try {
      return await write;
    } finally {
      this.pendingWrites.delete(write);
    }
  }

  private ensureCacheGeneration(generation: number) {
    if (generation !== this.cacheGeneration) throw VRCHAT_API_STALE_REQUEST;
  }

  private async parseResponseCookies(response: Response, cacheGeneration: number) {
    const settings: Partial<VRChatApiSettings> = {};
    const cookieHeaders = response.headers.getSetCookie();
    for (const cookieHeader of cookieHeaders) {
      const cookies = parseSetCookieHeader(cookieHeader);
      for (const cookie of cookies) {
        const expiry = cookie.expires ? Math.floor(cookie.expires.getTime() / 1000) : null;
        switch (cookie.name) {
          case 'auth':
            settings.authCookie = cookie.value;
            settings.authCookieExpiry = expiry;
            break;
          case 'twoFactorAuth':
            settings.twoFactorCookie = cookie.value;
            settings.twoFactorCookieExpiry = expiry;
            break;
        }
      }
    }
    if (!Object.keys(settings).length) return;
    this.ensureCacheGeneration(cacheGeneration);
    await this.trackWrite(this.updateSettings(settings));
    this.ensureCacheGeneration(cacheGeneration);
  }
}
