import type {
  Avatar,
  InviteMessageType as VRChatInviteMessageType,
  NotificationType as VRChatNotificationType,
  UserStatus as VRChatUserStatus,
} from 'vrchat';

// `satisfies` only checks that each value is a valid upstream member, not that
// every member is present. CoversUpstream fails the build when the dependency
// adds one, so these stay complete rather than silently drifting.
type CoversUpstream<Upstream extends string, Local extends string> = [Upstream] extends [Local]
  ? unknown
  : { error: 'missing upstream members'; missing: Exclude<Upstream, Local> };

export const UserStatus = {
  Active: 'active',
  JoinMe: 'join me',
  AskMe: 'ask me',
  Busy: 'busy',
  Offline: 'offline',
} as const satisfies Record<string, VRChatUserStatus>;
export type UserStatus = (typeof UserStatus)[keyof typeof UserStatus];
const _userStatusCoversUpstream: CoversUpstream<VRChatUserStatus, UserStatus> = {};
void _userStatusCoversUpstream;

export const NotificationType = {
  Boop: 'boop',
  FriendRequest: 'friendRequest',
  Invite: 'invite',
  InviteResponse: 'inviteResponse',
  Message: 'message',
  RequestInvite: 'requestInvite',
  RequestInviteResponse: 'requestInviteResponse',
  Votetokick: 'votetokick',
} as const satisfies Record<string, VRChatNotificationType>;
export type NotificationType = (typeof NotificationType)[keyof typeof NotificationType];
const _notificationTypeCoversUpstream: CoversUpstream<VRChatNotificationType, NotificationType> =
  {};
void _notificationTypeCoversUpstream;

export const InviteMessageType = {
  Message: 'message',
  Response: 'response',
  Request: 'request',
  RequestResponse: 'requestResponse',
} as const satisfies Record<string, VRChatInviteMessageType>;
export type InviteMessageType = (typeof InviteMessageType)[keyof typeof InviteMessageType];
const _inviteMessageTypeCoversUpstream: CoversUpstream<VRChatInviteMessageType, InviteMessageType> =
  {};
void _inviteMessageTypeCoversUpstream;

export interface WorldContext {
  players: {
    displayName: string;
    userId: string;
  }[];
  instanceId?: string;
  loaded: boolean;
  joinedAt?: number;
}

export type AvatarEx = Avatar & {
  favoriteGroup?: string;
  favoriteId?: string;
};

export interface PersistedAvatar {
  id: string;
  imageUrl: string;
  name: string;
}

export type InviteMessageEx = {
  type: InviteMessageType;
  slot: number;
  message: string;
  canUpdateAtTimeStamp: number;
};
