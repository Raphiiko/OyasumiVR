import { BehaviorSubject, Subject } from 'rxjs';
import { expect, it, vi } from 'vitest';
import { SteamAchievements, SteamService } from './steam.service';
import type { SleepService } from './sleep.service';
import type { VRChatService } from './vrchat-api/vrchat.service';
import type { AppSettingsService } from './app-settings.service';
import type { MqttService } from './mqtt/mqtt.service';

const log = vi.hoisted(() => ({ debug: vi.fn(), info: vi.fn(), error: vi.fn(), warn: vi.fn() }));
vi.mock('@tauri-apps/plugin-log', () => log);
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('./vrchat-api/vrchat.service', () => ({ VRChatService: class {} }));

it('keeps unlocking an achievement after Steam fails to read it', async () => {
  const changes = new Subject<{ mode: boolean; reason: object }>();
  const vrchat = {
    vrchatProcessActive: new BehaviorSubject(true),
    world: new BehaviorSubject({ players: [], joinedAt: Date.now() }),
  };
  const steam = new SteamService(
    { onSleepModeChange: changes } as unknown as SleepService,
    vrchat as unknown as VRChatService,
    {} as AppSettingsService,
    {} as MqttService
  );
  vi.spyOn(steam, 'getAchievement')
    .mockRejectedValueOnce('FAILED_TO_GET_STATUS')
    .mockResolvedValue(false);
  const warned = Promise.withResolvers<void>();
  log.warn.mockImplementationOnce(() => warned.resolve());
  const unlocked = Promise.withResolvers<void>();
  const unlock = vi.spyOn(steam, 'setAchievement').mockImplementation(() => {
    unlocked.resolve();
    return Promise.resolve();
  });
  await steam['handleAchievement_QUICK_EEPER']();
  const detected = {
    mode: true,
    reason: { type: 'AUTOMATION', automation: 'SLEEP_MODE_ENABLE_FOR_SLEEP_DETECTOR' },
  };

  changes.next(detected);
  await warned.promise;
  changes.next(detected);
  await unlocked.promise;

  expect(log.warn).toHaveBeenCalledOnce();
  expect(log.warn.mock.calls[0][0]).toContain('FAILED_TO_GET_STATUS');
  expect(steam.getAchievement).toHaveBeenCalledTimes(2);
  expect(unlock).toHaveBeenCalledOnce();
  expect(unlock).toHaveBeenCalledWith(SteamAchievements.QUICK_EEPER, true);
});

it('retries a one-time achievement on the next trigger after a failed unlock', async () => {
  vi.useFakeTimers();
  const clientStatus = new Subject<string>();
  const steam = new SteamService(
    {} as SleepService,
    {} as VRChatService,
    {} as AppSettingsService,
    { clientStatus } as unknown as MqttService
  );
  vi.spyOn(steam, 'getAchievement')
    .mockRejectedValueOnce('FAILED_TO_GET_STATUS')
    .mockResolvedValue(false);
  const unlock = vi.spyOn(steam, 'setAchievement').mockResolvedValue();
  await steam['handleAchievement_CONNECT_HASS']();

  clientStatus.next('CONNECTED');
  await vi.advanceTimersByTimeAsync(1000);
  clientStatus.next('DISCONNECTED');
  clientStatus.next('CONNECTED');
  await vi.advanceTimersByTimeAsync(1000);

  expect(steam.getAchievement).toHaveBeenCalledTimes(2);
  expect(unlock).toHaveBeenCalledExactlyOnceWith(SteamAchievements.HASS_CON, true);
  vi.useRealTimers();
});
