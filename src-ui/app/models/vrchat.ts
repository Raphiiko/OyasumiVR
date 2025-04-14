import type { Avatar } from 'vrchat/dist';

export interface WorldContext {
  playerCount: number;
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
