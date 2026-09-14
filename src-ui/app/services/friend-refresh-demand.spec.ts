import { BehaviorSubject, of, Subject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CurrentUser, LimitedUserFriend } from 'vrchat';
import { AUTOMATION_CONFIGS_DEFAULT, type JoinNotificationsMode } from '../models/automations';
import { CACHE_STORE } from '../globals';
import { JoinNotificationsService } from './join-notifications.service';
import { SleepModeDisableOnPlayerJoinLeaveAutomationService } from './sleep-detection-automations/sleep-mode-disable-on-player-join-leave.service';
import { VRChatAPI } from './vrchat-api/vrchat-api';

vi.mock('@tauri-apps/plugin-log', () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));
vi.mock('../utils/app-utils', () => ({ getVersion: async () => 'test' }));

const me = { id: 'me', displayName: 'Me' } as CurrentUser;
const friend = { id: 'friend', displayName: 'Friend' } as LimitedUserFriend;

async function setup() {
  const configs = new BehaviorSubject(structuredClone(AUTOMATION_CONFIGS_DEFAULT));
  const user = new BehaviorSubject<CurrentUser | null>(me);
  const api = new VRChatAPI(
    of(undefined!),
    async () => {},
    () => {}
  );
  await api.init(user, () => {});
  const pages = vi
    .spyOn(
      api as unknown as {
        fetchPaginatedData: () => Promise<LimitedUserFriend[]>;
      },
      'fetchPaginatedData'
    )
    .mockResolvedValue([friend]);
  const calls = [vi.fn(() => api.listFriends()), vi.fn(() => api.listFriends())];
  const vrchat = {
    user,
    world: new BehaviorSubject({ players: [], loaded: true, instanceId: 'instance' }),
    vrchatProcessActive: new BehaviorSubject(true),
  };
  const sleep = { mode: new BehaviorSubject(false) };
  const log = { logEvents: new Subject() };
  const services = [
    new JoinNotificationsService(
      { configs } as never,
      sleep as never,
      { ...vrchat, listFriends: calls[0] } as never,
      {} as never,
      log as never,
      {} as never
    ),
    new SleepModeDisableOnPlayerJoinLeaveAutomationService(
      { configs } as never,
      sleep as never,
      { ...vrchat, listFriends: calls[1] } as never,
      log as never
    ),
  ];
  for (const service of services) await service.init();
  const setMode = (mode: JoinNotificationsMode, playerIds: string[] = [], enabled = true) => {
    const value = structuredClone(configs.value);
    Object.assign(value.JOIN_NOTIFICATIONS, {
      joinNotification: mode,
      leaveNotification: 'DISABLED',
      joinSoundMode: 'DISABLED',
      leaveSoundMode: 'DISABLED',
      playerIds,
    });
    Object.assign(value.SLEEP_MODE_DISABLE_ON_PLAYER_JOIN_OR_LEAVE, {
      joinMode: mode,
      leaveMode: 'DISABLED',
      enabled,
      playerIds,
    });
    configs.next(value);
  };
  return { configs, user, pages, calls, services, setMode };
}

describe('friend refresh demand', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(CACHE_STORE, 'get').mockResolvedValue(undefined);
    vi.spyOn(CACHE_STORE, 'set').mockResolvedValue(undefined);
    vi.spyOn(CACHE_STORE, 'delete').mockResolvedValue(false);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it.each(['DISABLED', 'EVERYONE', 'WHITELIST', 'BLACKLIST'] as const)(
    'makes no demand for defaults or friend-independent %s modes',
    async (mode) => {
      const h = await setup();
      h.user.next({ ...me });
      h.setMode(mode);
      h.user.next({ ...me });
      await vi.advanceTimersByTimeAsync(3600001);
      h.user.next({ ...me });
      await vi.advanceTimersByTimeAsync(0);
      h.calls.forEach((call) => expect(call).not.toHaveBeenCalled());
      expect(h.pages).not.toHaveBeenCalled();
      expect(CACHE_STORE.set).not.toHaveBeenCalled();
    }
  );

  it.each(['FRIEND', 'WHITELIST', 'BLACKLIST'] as const)(
    'shares immediate %s demand and preserves cached and expired refreshes',
    async (mode) => {
      const h = await setup();
      h.setMode(mode, ['friend']);
      await vi.advanceTimersByTimeAsync(0);
      h.calls.forEach((call) => expect(call).toHaveBeenCalledTimes(1));
      expect(h.pages).toHaveBeenCalledTimes(2);
      expect(CACHE_STORE.set).toHaveBeenCalledTimes(1);
      h.user.next({ ...me });
      await vi.advanceTimersByTimeAsync(0);
      h.calls.forEach((call) => expect(call).toHaveBeenCalledTimes(2));
      expect(h.pages).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(3600001);
      h.user.next({ ...me });
      await vi.advanceTimersByTimeAsync(0);
      expect(h.pages).toHaveBeenCalledTimes(4);
      expect(CACHE_STORE.set).toHaveBeenCalledTimes(2);
    }
  );

  it('honors the sleep enable flag and keeps the notification enable flag inert', async () => {
    const h = await setup();
    h.setMode('FRIEND', [], false);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.calls[0]).toHaveBeenCalledTimes(1);
    expect(h.calls[1]).not.toHaveBeenCalled();
    h.setMode('FRIEND');
    await vi.advanceTimersByTimeAsync(0);
    expect(h.calls[0]).toHaveBeenCalledTimes(1);
    expect(h.calls[1]).toHaveBeenCalledTimes(1);
  });

  it.each(['joinNotification', 'leaveNotification', 'joinSoundMode', 'leaveSoundMode'] as const)(
    'loads the mapping when only %s needs friends',
    async (key) => {
      const h = await setup();
      h.setMode('DISABLED');
      const value = structuredClone(h.configs.value);
      value.JOIN_NOTIFICATIONS[key] = 'FRIEND';
      h.configs.next(value);
      await vi.advanceTimersByTimeAsync(0);
      expect(h.calls[0]).toHaveBeenCalledTimes(1);
      expect(h.calls[1]).not.toHaveBeenCalled();
    }
  );

  it('loads the sleep mapping when only the leave mode needs friends', async () => {
    const h = await setup();
    h.setMode('DISABLED');
    const value = structuredClone(h.configs.value);
    value.SLEEP_MODE_DISABLE_ON_PLAYER_JOIN_OR_LEAVE.leaveMode = 'FRIEND';
    h.configs.next(value);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.calls[0]).not.toHaveBeenCalled();
    expect(h.calls[1]).toHaveBeenCalledTimes(1);
  });

  it.each(['logout', 'disable'] as const)('drops pending mappings on %s', async (trigger) => {
    const h = await setup();
    let resolve!: (friends: LimitedUserFriend[]) => void;
    const pending = new Promise<LimitedUserFriend[]>((done) => (resolve = done));
    h.calls.forEach((call) => call.mockReturnValue(pending));
    h.setMode('FRIEND');
    if (trigger === 'logout') h.user.next(null);
    else h.setMode('DISABLED');
    resolve([friend]);
    await vi.advanceTimersByTimeAsync(0);
    h.services.forEach((service) => expect(service['friends']).toEqual([]));
    h.calls.forEach((call) => call.mockResolvedValue([friend]));
    if (trigger === 'logout') h.user.next(me);
    else h.setMode('FRIEND');
    await vi.advanceTimersByTimeAsync(0);
    h.services.forEach((service) => expect(service['friends']).toEqual([friend]));
  });

  it('retains the last mapping after an error and retries on a later user update', async () => {
    const h = await setup();
    h.calls.forEach((call) => call.mockResolvedValue([friend]));
    h.setMode('FRIEND');
    await vi.advanceTimersByTimeAsync(0);
    h.calls.forEach((call) => call.mockRejectedValueOnce('offline'));
    h.user.next({ ...me });
    await vi.advanceTimersByTimeAsync(0);
    h.services.forEach((service) => expect(service['friends']).toEqual([friend]));
    h.user.next({ ...me });
    await vi.advanceTimersByTimeAsync(0);
    h.calls.forEach((call) => expect(call).toHaveBeenCalledTimes(3));
  });
});
