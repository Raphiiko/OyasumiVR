import { describe, expect, it, vi } from 'vitest';
import { FriendSelectionModalComponent } from './friend-selection-modal.component';
import { VRCHAT_API_STALE_REQUEST } from '../../services/vrchat-api/vrchat-api';

describe('FriendSelectionModalComponent', () => {
  it('closes when friend loading is cancelled by a session change', async () => {
    const close = vi.fn();
    const context = {
      close,
      loadingState: 'LOADING',
      vrchat: {
        listFriends: vi.fn().mockRejectedValue(VRCHAT_API_STALE_REQUEST),
      },
    };

    await (
      FriendSelectionModalComponent.prototype as unknown as {
        loadFriends(this: typeof context): Promise<void>;
      }
    ).loadFriends.call(context);

    expect(close).toHaveBeenCalledOnce();
    expect(context.loadingState).toBe('LOADING');
  });
});
