import { BehaviorSubject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import type { CurrentUser } from 'vrchat';
import { VrcAvatarSelectModalComponent } from './vrc-avatar-select-modal.component';
import { VRCHAT_API_STALE_REQUEST } from '../../services/vrchat-api/vrchat-api';

describe('VrcAvatarSelectModalComponent', () => {
  it('closes when avatar loading is cancelled by a session change', async () => {
    const close = vi.fn();
    const context = {
      activeCategory: '',
      cdr: { markForCheck: vi.fn() },
      close,
      vrchat: {
        listAvatars: vi.fn().mockRejectedValue(VRCHAT_API_STALE_REQUEST),
        user: new BehaviorSubject({ id: 'usr_test' } as CurrentUser),
      },
    };

    await (
      VrcAvatarSelectModalComponent.prototype as unknown as {
        fetchAvatars(this: typeof context, force?: boolean): Promise<void>;
      }
    ).fetchAvatars.call(context);

    expect(close).toHaveBeenCalledOnce();
    expect(context.activeCategory).toBe('LOADING');
  });
});
