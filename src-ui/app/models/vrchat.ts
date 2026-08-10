import type {
  Avatar,
  InviteMessageType as VRChatInviteMessageType,
  NotificationType as VRChatNotificationType,
  UserStatus as VRChatUserStatus,
} from 'vrchat';

export const UserStatus = {
  Active: 'active',
  JoinMe: 'join me',
  AskMe: 'ask me',
  Busy: 'busy',
  Offline: 'offline',
} as const satisfies Record<string, VRChatUserStatus>;
export type UserStatus = (typeof UserStatus)[keyof typeof UserStatus];

export const NotificationType = {
  FriendRequest: 'friendRequest',
  Invite: 'invite',
  InviteResponse: 'inviteResponse',
  Message: 'message',
  RequestInvite: 'requestInvite',
  RequestInviteResponse: 'requestInviteResponse',
  Votetokick: 'votetokick',
} as const satisfies Record<string, VRChatNotificationType>;
export type NotificationType = (typeof NotificationType)[keyof typeof NotificationType];

export const InviteMessageType = {
  Message: 'message',
  Response: 'response',
  Request: 'request',
  RequestResponse: 'requestResponse',
} as const satisfies Record<string, VRChatInviteMessageType>;
export type InviteMessageType = (typeof InviteMessageType)[keyof typeof InviteMessageType];

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
