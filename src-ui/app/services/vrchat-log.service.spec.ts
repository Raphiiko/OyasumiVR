import { BehaviorSubject, firstValueFrom, Subject } from 'rxjs';
import { afterEach, expect, it, vi } from 'vitest';
import type { VRChatOnPlayerJoinedEvent } from '../models/vrchat-log-event';
import type { WorldContext } from '../models/vrchat';
import { VRChatLogService } from './vrchat-log.service';
import { VRChatService } from './vrchat-api/vrchat.service';
import { SteamAchievements, SteamService } from './steam.service';
import type { SleepService } from './sleep.service';
import type { AppSettingsService } from './app-settings.service';
import type { MqttService } from './mqtt/mqtt.service';

vi.mock('@tauri-apps/plugin-log', () => ({ debug: vi.fn(), info: vi.fn(), error: vi.fn() }));
vi.mock('src-ui/app/services/modal.service', () => ({ ModalService: class {} }));
vi.mock('./vrchat-api/vrchat-api', () => ({ VRChatAPI: class {} }));
vi.mock('./vrchat-api/vrchat-auth', () => ({ VRChatAuth: class {} }));
vi.mock('./vrchat-api/vrchat-socket', () => ({ VRChatSocket: class {} }));
vi.mock('./error-reporting.service', () => ({ ErrorReportingService: class {} }));
vi.mock('src-ui/app/models/vrchat-api-settings', () => import('../models/vrchat-api-settings'));

const time = 1787517755000;
afterEach(() => vi.useRealTimers());

it.each(['OnPlayerJoined', 'OnPlayerLeft', 'OnLocationChange'])(
  'preserves native epoch milliseconds for %s',
  async (event) => {
    const service = new VRChatLogService();
    const parsed = firstValueFrom(service.logEvents);
    service['handleLogEvent']({ time, event, data: 'Me (usr_me)', initialLoad: true });
    expect((await parsed).timestamp.toISOString()).toBe('2026-08-23T20:42:35.000Z');
    expect((await parsed).initialLoad).toBe(true);
  }
);

it.each([-1, 0, 20 * 60_000 - 1, 20 * 60_000, 21 * 60_000])(
  'checks Quick Eeper at %i milliseconds after the current user joins',
  async (elapsed) => {
    vi.useFakeTimers();
    vi.setSystemTime(time + elapsed);
    // parse the current user's native join event
    const logs = new VRChatLogService();
    const parsed = firstValueFrom(logs.logEvents);
    logs['handleLogEvent']({
      time,
      event: 'OnPlayerJoined',
      data: 'Me (usr_me)',
      initialLoad: false,
    });

    // store the join time through the world handler
    const world = new BehaviorSubject<WorldContext>({ loaded: false, players: [] });
    const vrchat: VRChatService = Object.assign(Object.create(VRChatService.prototype), {
      auth: { user: new BehaviorSubject({ id: 'usr_me' }) },
      worldSubject: world,
      world: world.asObservable(),
      vrchatProcessActive: new BehaviorSubject(true),
    });
    await vrchat['handlePlayerJoined']((await parsed) as VRChatOnPlayerJoinedEvent);
    expect(world.value.joinedAt).toBe(time);

    // trigger sleep detection with Steam writes simulated
    const changes = new Subject<{ mode: boolean; reason: object }>();
    const steam = new SteamService(
      { onSleepModeChange: changes } as unknown as SleepService,
      vrchat,
      {} as AppSettingsService,
      {} as MqttService
    );
    vi.spyOn(steam, 'getAchievement').mockResolvedValue(false);
    const unlock = vi.spyOn(steam, 'setAchievement').mockResolvedValue();
    await steam['handleAchievement_QUICK_EEPER']();
    changes.next({
      mode: true,
      reason: { type: 'AUTOMATION', automation: 'SLEEP_MODE_ENABLE_FOR_SLEEP_DETECTOR' },
    });
    await vi.runAllTimersAsync();
    expect(unlock.mock.calls).toEqual(
      elapsed >= 0 && elapsed < 20 * 60_000 ? [[SteamAchievements.QUICK_EEPER, true]] : []
    );
    changes.complete();
  }
);
