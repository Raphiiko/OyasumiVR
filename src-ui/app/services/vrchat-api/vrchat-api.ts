import { ClientOptions, fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { error, info, warn } from '@tauri-apps/plugin-log';
import { getVersion } from 'src-ui/app/utils/app-utils';
import { TaskQueue } from 'src-ui/app/utils/task-queue';
import { parse as parseSetCookieHeader } from 'set-cookie-parser';
import { serialize as serializeCookie } from 'cookie';
import { InviteMessageType } from 'vrchat/dist';
import type {
  CurrentUser,
  InviteMessage,
  LimitedUser,
  LimitedUserGroups,
  UserStatus,
} from 'vrchat/dist';
import { CachedValue } from 'src-ui/app/utils/cached-value';
import { AvatarEx, InviteMessageEx } from 'src-ui/app/models/vrchat';
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

export class VRChatAPI {
  private userAgent!: string;
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
  private _friendsCache: CachedValue<LimitedUser[]> = new CachedValue<LimitedUser[]>(
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
    private updateSettings: (settings: Partial<VRChatApiSettings>) => void
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
    this._currentUserCache.clear();
    this._friendsCache.clear();
    this._avatarCache.clear();
    this._groupsCache.clear();
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

  public async verify2FA(code: string, method: 'totp' | 'otp' | 'emailotp') {
    const headers = await this.getDefaultHeaders();
    const response = await fetch(`${BASE_URL}/auth/twofactorauth/${method}/verify`, {
      method: 'POST',
      body: JSON.stringify({ code }),
      headers,
    });
    // If we received a 401, the code was likely incorrect
    const responseData = await response.json().catch(() => {});
    if (response.status === 400 && responseData?.verified === false) {
      warn(`[VRChat] 2FA Verification failed: Invalid code`);
      throw 'INVALID_CODE';
    }
    // If it's not ok, it's unexpected
    if (!response.ok || responseData?.verified === false) {
      error(
        `[VRChat] Received unexpected response from /auth/twofactorauth/${method}/verify: ${JSON.stringify(
          response
        )}`
      );
      throw 'UNEXPECTED_RESPONSE';
    }
    // Process any auth cookie if we get any
    await this.parseResponseCookies(response);
  }

  public async getCurrentUser(
    credentials?: {
      username: string;
      password: string;
    },
    force = false
  ): Promise<CurrentUser> {
    // Set available headers
    const headers: Record<string, string> = {
      ...(await this.getDefaultHeaders()),
    };
    if (credentials) {
      force = true;
      // Set credentials
      headers['Authorization'] = `Basic ${btoa(
        encodeURIComponent(credentials.username) + ':' + encodeURIComponent(credentials.password)
      )}`;
    }
    // If we have the user cached, return that.
    if (!force) {
      const user = this._currentUserCache.get();
      if (user) {
        info(`[VRChat] Loaded user from cache`);
        return user;
      }
    }
    // Request the current user
    const response = await fetch(`${BASE_URL}/auth/user`, {
      headers,
    });
    const responseData: CurrentUser | { requiresTwoFactorAuth: string[] } = await response
      .json()
      .catch(() => {});
    // If we received a 401, there is probably an error included
    if (response.status === 401) {
      // Try parse the error message
      const message: string = (responseData as any)?.error?.message ?? '';
      // Check for known errors
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
          error(
            `[VRChat] Received unexpected response from /auth/user: ${JSON.stringify(response)}`
          );
          throw 'UNEXPECTED_RESPONSE';
      }
    }
    // If it's not ok, it's unexpected
    if (!response.ok) {
      error(`[VRChat] Received unexpected response from /auth/user: ${JSON.stringify(response)}`);
      throw 'UNEXPECTED_RESPONSE';
    }
    // Process any auth cookie if we get any (even if we still need to verify 2FA)
    await this.parseResponseCookies(response);
    // Handle 2FA required response
    if (responseData.hasOwnProperty('requiresTwoFactorAuth')) {
      const data = responseData as { requiresTwoFactorAuth: string[] };
      const methods = data.requiresTwoFactorAuth.map((method) => method.toLowerCase());
      info(
        `[VRChat] 2FA Required for login. (methods=${JSON.stringify(data.requiresTwoFactorAuth)})`
      );
      if (methods.includes('totp')) throw '2FA_TOTP_REQUIRED';
      if (methods.includes('emailotp')) throw '2FA_EMAILOTP_REQUIRED';
      if (methods.includes('otp')) throw '2FA_OTP_REQUIRED';
      error(
        '[VRChat] 2FA Required for login, but no supported method found. Available methods: ' +
          JSON.stringify(data.requiresTwoFactorAuth)
      );
      throw '2FA_TOTP_REQUIRED'; // Should never happen
    }
    // Cache the user
    const user = responseData as CurrentUser;
    this._currentUserCache.set(user);
    // Otherwise, return the fetched user
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
    // Throw if we don't have a current user
    const userId = (await firstValueFrom(this.user))?.id;
    if (!userId) {
      error('[VRChat] Tried ensuring an invite message while not logged in');
      throw new Error('Tried ensuring an invite message while not logged in');
    }
    // Sanitize message
    message = message.trim().replace(/\s+/g, ' ').slice(0, 64);
    // Get known messages (cached or fetched)
    const cache = this._inviteMessageCaches[type];
    let messages: InviteMessageEx[] | undefined = cache.get();
    if (!messages) {
      const result = await this.apiCallQueue.queueTask<Response>({
        typeId: 'LIST_INVITE_MESSAGES',
        runnable: async () => {
          return await fetch(`${BASE_URL}/message/${userId}/${type}`, {
            headers: await this.getDefaultHeaders(),
          });
        },
      });
      if (result.error) throw result.error;
      if (!result.result?.ok) throw result.result;
      const data = await result.result.json();
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
      // Cache the retrieved messages
      cache.set(messages!);
      console.warn('RETRIEVED MESSAGES', { collection: type, messages });
    } else {
      console.warn('CACHED MESSAGES', { collection: type, messages });
    }
    // If we have a message that exactly matches the one we want, return that
    let slot = messages!.find((m) => m.message === message);
    if (slot) return slot;
    // If we don't have a message that exactly matches the one we want, find the highest slot we can overwrite
    messages!.sort((a, b) => b.slot - a.slot);
    slot = messages!.find((m) => Date.now() >= m.canUpdateAtTimeStamp);
    // If we don't have a slot, we can't overwrite any existing messages, so we will return null
    if (!slot) return null;
    // Update the messaage in the slot
    const result = await this.apiCallQueue.queueTask<Response>({
      typeId: 'UPDATE_INVITE_MESSAGE',
      runnable: async () => {
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
    // Cache the new messages
    cache.set(messages!);
    console.warn('UPDATED MESSAGES', { collection: type, messages });

    return messages?.find((m) => m.slot === slot.slot) ?? null;
  }

  public async listFriends(force = false): Promise<LimitedUser[]> {
    // If we have a valid cache and aren't forcing the fetch, return the cached value
    if (!force) {
      const cachedFriends = this._friendsCache.get();
      if (cachedFriends) return cachedFriends;
    }
    // Throw if we don't have a current user
    const userId = (await firstValueFrom(this.user))?.id;
    if (!userId) {
      error('[VRChat] Tried listing friends while not logged in');
      throw new Error('Tried listing friends while not logged in');
    }
    // If we are already listing friends, just await that result
    if (this._friendFetcher.value) {
      await firstValueFrom(this._friendFetcher); // We don't care about the result, just that it completes
      return this._friendsCache.get() ?? [];
    }
    // Fetch friends
    const friendFetchCompletion = new Subject<'SUCCESS' | 'FAILED'>();
    this._friendFetcher.next(friendFetchCompletion.asObservable());
    const friends: LimitedUser[] = [];
    // Fetch online and active friends
    let fetchResult: 'SUCCESS' | 'FAILED' = 'FAILED';
    try {
      for (const offline of ['false', 'true']) {
        const response = await this.fetchPaginatedData<LimitedUser>({
          url: `${BASE_URL}/auth/user/friends`,
          apiCallTypeId: 'LIST_FRIENDS',
          query: {
            offline,
          },
          maxEntries: MAX_VRCHAT_FRIENDS,
        });
        fetchResult = 'SUCCESS';
        friends.push(...response);
      }
    } catch (e) {
      error('[VRChat] Failed to list friends: ' + JSON.stringify(e));
      fetchResult = 'FAILED';
    }
    if (fetchResult === 'SUCCESS') this._friendsCache.set(friends);
    friendFetchCompletion.next(fetchResult);
    this._friendFetcher.next(null);
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
    if (!force) {
      const cachedGroups = this._groupsCache.get();
      if (cachedGroups) return cachedGroups;
    }
    const userId = (await firstValueFrom(this.user))?.id;
    if (!userId) {
      error('[VRChat] Tried getting user groups while not logged in');
      throw new Error('Tried getting user groups while not logged in');
    }
    try {
      const result = await this.apiCallQueue.queueTask<Response>({
        typeId: 'LIST_GROUPS',
        runnable: async () => {
          return await fetch(`${BASE_URL}/users/${userId}/groups`, {
            headers: await this.getDefaultHeaders(),
          });
        },
      });
      if (result.error) throw result.error;
      if (!result.result?.ok) throw result.result;
      const data = await result.result.json();
      this._groupsCache.set(data);
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
    // If we have a valid cache and aren't forcing the fetch, return the cached value
    if (!force) {
      const cachedAvatars = this._avatarCache.get();
      if (cachedAvatars) return cachedAvatars;
    }
    // Throw if we don't have a current user
    const userId = (await firstValueFrom(this.user))?.id;
    if (!userId) {
      error('[VRChat] Tried listing avatars while not logged in');
      throw new Error('Tried listing avatars while not logged in');
    }
    // If we are already listing avatars, just await that result
    if (this._avatarFetcher.value) {
      await firstValueFrom(this._avatarFetcher); // We don't care about the result, just that it completes
      return this._avatarCache.get() ?? [];
    }
    // Fetch avatars
    const avatarFetchCompletion = new Subject<'SUCCESS' | 'FAILED'>();
    this._avatarFetcher.next(avatarFetchCompletion.asObservable());
    let avatars: AvatarEx[] = [];
    let fetchResult: 'SUCCESS' | 'FAILED' = 'FAILED';
    try {
      const ownAvatars = await this.fetchPaginatedData<AvatarEx>({
        url: `${BASE_URL}/avatars`,
        apiCallTypeId: 'LIST_AVATARS_UPLOADED',
        query: {
          user: 'me',
          releaseStatus: 'all',
          sort: 'updated',
          order: 'descending',
        },
        maxEntries: MAX_UPLOADED_AVATARS,
      });
      avatars.push(...ownAvatars);
      fetchResult = 'SUCCESS';
    } catch (e) {
      error('[VRChat] Failed to list uploaded avatars: ' + JSON.stringify(e));
      fetchResult = 'FAILED';
    }
    if (fetchResult != 'FAILED') {
      try {
        const favAvatars = await this.fetchPaginatedData<AvatarEx>({
          url: `${BASE_URL}/avatars/favorites`,
          apiCallTypeId: 'LIST_AVATARS_FAVOURITE',
          query: {
            sort: 'updated',
          },
          maxEntries: MAX_FAVOURITE_AVATARS,
        });
        avatars.push(...favAvatars);
        fetchResult = 'SUCCESS';
      } catch (e) {
        error('[VRChat] Failed to list favourite avatars: ' + JSON.stringify(e));
        fetchResult = 'FAILED';
      }
    }
    avatars = uniqBy(avatars, 'id');
    if (fetchResult === 'SUCCESS') this._avatarCache.set(avatars);
    avatarFetchCompletion.next(fetchResult);
    this._avatarFetcher.next(null);
    return avatars;
  }

  public pollCurrentUser(): Promise<CompletionResult<CurrentUser>> {
    return this.apiCallQueue.queueTask<CurrentUser>({
      typeId: 'POLL_USER',
      runnable: () => this.getCurrentUser(undefined, true),
    });
  }

  public updateCachedGroup(groupId: string, group: Partial<LimitedUserGroups>) {
    if (group.groupId && group.groupId !== groupId) {
      throw new Error("Called updateCachedGroup with a group that doesn't match the groupId");
    }
    const groups = this._groupsCache.get() ?? [];
    const index = groups.findIndex((g) => g.groupId === groupId);
    if (index !== -1) {
      // Update the group
      groups[index] = { ...groups[index], ...group };

      // If the group is representing, we need to "unrepresent" any other groups
      if (group.isRepresenting) {
        for (const otherGroup of groups) {
          if (otherGroup.groupId !== groupId) {
            otherGroup.isRepresenting = false;
          }
        }
      }

      // Update the cache
      this._groupsCache.set(groups);
    }
  }

  private async fetchPaginatedData<T>(_options: {
    url: string;
    apiCallTypeId: string;
    query?: Record<string, string>;
    maxEntries?: number;
    rateLimit?: {
      maxRetries?: number;
      timeout?: number;
    };
  }): Promise<T[]> {
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
      nextOffset = 100;
      const response = await this.apiCallQueue.queueTask<Response>({
        typeId: options.apiCallTypeId,
        runnable: async () => {
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
      // Handle rate limiting
      if (response.result?.status === 429) {
        if (rateLimitRetries < options.rateLimit.maxRetries) {
          // Wait for a bit and retry
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
      // Handle results
      if (response.result?.ok) {
        // Add entries to list
        const data: T[] = await response.result.json();
        entries.push(...data);
        // If we got some entries, continue fetching
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
    contentType: string = 'application/json'
  ): Promise<Record<string, string>> {
    const settings = await firstValueFrom(this.settings);
    const cookies = [];
    if (settings.authCookie) cookies.push(serializeCookie('auth', settings.authCookie));
    if (settings.twoFactorCookie)
      cookies.push(serializeCookie('twoFactorAuth', settings.twoFactorCookie));
    return {
      Cookie: cookies.join('; '),
      'User-Agent': this.userAgent,
      'Content-Type': contentType,
    };
  }

  private async parseResponseCookies(response: Response) {
    const cookieHeaders = response.headers.getSetCookie();
    for (const cookieHeader of cookieHeaders) {
      const cookies = parseSetCookieHeader(cookieHeader);
      for (const cookie of cookies) {
        const expiry = Math.floor((cookie.expires || new Date()).getTime() / 1000);
        switch (cookie.name) {
          case 'auth':
            await this.updateSettings({
              authCookie: cookie.value,
              authCookieExpiry: expiry,
            });
            break;
          case 'twoFactorAuth':
            await this.updateSettings({
              twoFactorCookie: cookie.value,
              twoFactorCookieExpiry: expiry,
            });
            break;
        }
      }
    }
  }
}
