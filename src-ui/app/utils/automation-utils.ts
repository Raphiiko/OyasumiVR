import type { JoinNotificationsMode } from '../models/automations';

export function joinModeNeedsFriends(mode: JoinNotificationsMode, playerIds: string[]): boolean {
  return (
    mode === 'FRIEND' || ((mode === 'WHITELIST' || mode === 'BLACKLIST') && playerIds.length > 0)
  );
}
