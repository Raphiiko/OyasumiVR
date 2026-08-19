import { describe, expect, it, vi } from 'vitest';
import type { LimitedUserFriend } from 'vrchat';
import { PlayerListComponent } from './player-list.component';
import { VRCHAT_API_STALE_REQUEST } from '../../services/vrchat-api/vrchat-api';

describe('PlayerListComponent', () => {
  it('keeps the player list when friend loading is cancelled', async () => {
    const player = { id: 'usr_friend' } as LimitedUserFriend;
    const context = {
      cdr: { markForCheck: vi.fn() },
      emitPlayerListChange: vi.fn(),
      playerList: [player],
      vrchat: {
        listFriends: vi.fn().mockRejectedValue(VRCHAT_API_STALE_REQUEST),
      },
    };

    await (
      PlayerListComponent.prototype as unknown as {
        refreshPlayerList(this: typeof context, playerIds: string[]): Promise<void>;
      }
    ).refreshPlayerList.call(context, ['usr_other']);

    expect(context.playerList).toEqual([player]);
    expect(context.emitPlayerListChange).not.toHaveBeenCalled();
  });
});
