import { BehaviorSubject, Subject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import type { CurrentUser, LimitedUserFriend } from 'vrchat';
import { TranslocoService } from '@jsverse/transloco';
import { AUTOMATION_CONFIGS_DEFAULT } from '../models/automations';
import { AutomationConfigService } from './automation-config.service';
import { JoinNotificationsService } from './join-notifications.service';
import { NotificationService } from './notification.service';
import { SleepService } from './sleep.service';
import { VRChatLogService } from './vrchat-log.service';
import { VRChatService } from './vrchat-api/vrchat.service';

describe('JoinNotificationsService', () => {
  it('continues loading friends after a failed request', async () => {
    const user = new BehaviorSubject<CurrentUser | null>(null);
    const friend = { id: 'usr_friend', displayName: 'Friend' } as LimitedUserFriend;
    const listFriends = vi
      .fn()
      .mockRejectedValueOnce('NOT_LOGGED_IN')
      .mockResolvedValueOnce([friend]);
    const vrchat = {
      user,
      world: new BehaviorSubject({ players: [], loaded: false }),
      vrchatProcessActive: new BehaviorSubject(false),
      listFriends,
    } as unknown as VRChatService;
    const service = new JoinNotificationsService(
      {
        configs: new BehaviorSubject(AUTOMATION_CONFIGS_DEFAULT),
      } as unknown as AutomationConfigService,
      { mode: new BehaviorSubject(false) } as unknown as SleepService,
      vrchat,
      {} as NotificationService,
      { logEvents: new Subject() } as unknown as VRChatLogService,
      {} as TranslocoService
    );

    await service.init();
    user.next({ id: 'usr_first' } as CurrentUser);
    await vi.waitFor(() => expect(listFriends).toHaveBeenCalledOnce());
    user.next(null);
    user.next({ id: 'usr_second' } as CurrentUser);

    await vi.waitFor(() => expect(listFriends).toHaveBeenCalledTimes(2));
    expect((service as unknown as { friends: LimitedUserFriend[] }).friends).toEqual([friend]);
  });
});
