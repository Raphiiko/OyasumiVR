import type { Avatar, InviteMessageType } from 'vrchat/dist';

export interface WorldContext {
  players: {
    displayName: string;
    userId: string;
  }[];
  instanceId?: string;
  loaded: boolean;
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
