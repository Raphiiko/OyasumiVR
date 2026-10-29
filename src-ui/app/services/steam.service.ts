import { Injectable } from '@angular/core';
import { commands, events } from '../bindings';
import { FLAVOUR } from '../../build';
import {
  asyncScheduler,
  BehaviorSubject,
  switchMap,
  filter,
  scan,
  throttleTime,
  distinctUntilChanged,
  skip,
  map,
  combineLatest,
  debounceTime,
  take,
  tap,
} from 'rxjs';
import { debug, error, info, warn } from '@tauri-apps/plugin-log';
import { SleepService } from './sleep.service';
import { VRChatService } from './vrchat-api/vrchat.service';
import { DEV_VRCHAT_USER_ID } from '../globals';
import { sleep } from '../utils/promise-utils';
import { AppSettingsService } from './app-settings.service';
import { MqttService } from './mqtt/mqtt.service';

export const SteamAchievements = {
  START_OYASUMIVR: 'START_OYASUMIVR',
  SMSPAM: 'SMSPAM',
  SLEEP_8H: 'SLEEP_8H',
  QUICK_EEPER: 'QUICK_EEPER3',
  DEV_SLEEP: 'DEV_SLEEP',
  HASS_CON: 'HASS_CON',
} as const;

@Injectable({
  providedIn: 'root',
})
export class SteamService {
  private readonly _active = new BehaviorSubject<boolean>(false);
  public readonly active = this._active.asObservable();

  constructor(
    private sleep: SleepService,
    private vrchat: VRChatService,
    private appSettings: AppSettingsService,
    private mqttService: MqttService
  ) {
    this.active
      .pipe(distinctUntilChanged(), filter(Boolean))
      .subscribe(() => info('[Steam] Steamworks SDK initialized'));
  }

  public async init() {
    // Only run in Steam flavoured builds
    if (FLAVOUR !== 'STEAM' && FLAVOUR !== 'DEV') return;
    // Keep track of Steamworks status
    await this.getSteamActive();
    await events.steamworksReadyEvent.listen((data) => this._active.next(data.payload));
    // Check if Steamworks has been initialized.
    setTimeout(() => {
      if (!this._active.value) {
        error(
          '[Steam] Steamworks SDK could not be initialized: Steam is likely not running. Steam-related functionality will be unavailable.'
        );
      }
    }, 5000);

    // Handle achievements
    this.handleAchievement_START_OYASUMIVR();
    this.handleAchievement_SMSPAM();
    this.handleAchievement_SLEEP_8H();
    this.handleAchievement_QUICK_EEPER();
    this.handleAchievement_DEV_SLEEP();
    this.handleAchievement_CONNECT_HASS();
  }

  public async getSteamActive(): Promise<boolean> {
    const active = await commands.steamActive();
    this._active.next(active);
    return active;
  }

  public async setAchievement(achievementId: string, unlocked: boolean): Promise<void> {
    if (!this._active.value) throw 'STEAMWORKS_INACTIVE';
    if (unlocked) info('[Steam] Unlocking achievement: ' + achievementId);
    else info('[Steam] Locking achievement: ' + achievementId);
    await commands.steamAchievementSet(achievementId, unlocked);
  }

  public async getAchievement(achievementId: string): Promise<boolean> {
    if (!this._active.value) throw 'STEAMWORKS_INACTIVE';
    return commands.steamAchievementGet(achievementId);
  }

  /** Unlocks the achievement if it is still locked. Resolves false and logs instead of rejecting. */
  private async unlockAchievement(achievementId: string): Promise<boolean> {
    try {
      if (await this.getAchievement(achievementId)) return true;
      await this.setAchievement(achievementId, true);
      return true;
    } catch (e) {
      warn(`[Steam] Could not unlock achievement ${achievementId}: ${e}`);
      return false;
    }
  }

  // ACHIEVEMENT HANDLERS
  private async handleAchievement_START_OYASUMIVR() {
    // Set START_OYASUMIVR achievement when Steamworks becomes active
    this.active
      .pipe(
        distinctUntilChanged(),
        filter(Boolean),
        switchMap(() => this.unlockAchievement(SteamAchievements.START_OYASUMIVR)),
        filter(Boolean),
        take(1)
      )
      .subscribe();
  }

  private async handleAchievement_SMSPAM() {
    this.sleep.mode
      .pipe(
        skip(1),
        distinctUntilChanged(),
        scan((timestamps: number[]) => {
          const now = Date.now();
          const fiveSecondsAgo = now - 5000;
          return [...timestamps, now].filter((timestamp) => timestamp > fiveSecondsAgo);
        }, [] as number[]),
        filter((timestamps: number[]) => timestamps.length === 6),
        throttleTime(10000, asyncScheduler, { leading: true, trailing: false }),
        tap(() => debug('[Steam] SMSPAM achievement triggered')),
        switchMap(() => this.unlockAchievement(SteamAchievements.SMSPAM))
      )
      .subscribe();
  }

  private async handleAchievement_SLEEP_8H() {
    this.sleep.mode
      .pipe(
        skip(1),
        distinctUntilChanged(),
        scan(
          (acc: { enabledTimestamp?: number; trigger?: boolean }, sleepMode: boolean) => {
            acc.trigger = false;
            if (sleepMode) {
              acc.enabledTimestamp = Date.now();
              acc.trigger = false;
            } else if (acc.enabledTimestamp) {
              const duration = Date.now() - (acc.enabledTimestamp || 0);
              acc.enabledTimestamp = undefined;
              acc.trigger = duration >= 8 * 60 * 60 * 1000;
            }
            return acc;
          },
          {} as { enabledTimestamp?: number; trigger?: boolean }
        ),
        filter((acc) => !!acc.trigger),
        switchMap(() => this.vrchat.vrchatProcessActive.pipe(take(1))),
        tap(() => debug('[Steam] SLEEP_8H achievement triggered')),
        switchMap(() => this.unlockAchievement(SteamAchievements.SLEEP_8H))
      )
      .subscribe();
  }

  private async handleAchievement_QUICK_EEPER() {
    this.sleep.onSleepModeChange
      .pipe(
        // wait for automatic sleep detection
        filter((change) => {
          return (
            change.mode === true &&
            change.reason.type === 'AUTOMATION' &&
            change.reason.automation === 'SLEEP_MODE_ENABLE_FOR_SLEEP_DETECTOR'
          );
        }),
        // read the active VRChat session's join time
        switchMap(() => this.vrchat.vrchatProcessActive.pipe(take(1))),
        filter(Boolean),
        switchMap(() =>
          this.vrchat.world.pipe(
            map((world) => world.joinedAt ?? null),
            take(1)
          )
        ),
        filter(Boolean),
        // restrict eligibility to the first twenty minutes
        filter((timestamp) => {
          const elapsed = Date.now() - timestamp;
          return elapsed >= 0 && elapsed < 1000 * 60 * 20;
        }),
        // unlock only if the achievement is still locked
        tap(() => debug('[Steam] QUICK_EEPER achievement triggered')),
        switchMap(() => this.unlockAchievement(SteamAchievements.QUICK_EEPER))
      )
      .subscribe();
  }

  private async handleAchievement_DEV_SLEEP() {
    combineLatest([
      this.vrchat.world.pipe(
        map((world) => !!world.players.find((p) => p.userId === DEV_VRCHAT_USER_ID)),
        distinctUntilChanged()
      ),
      this.sleep.mode.pipe(
        map((mode) => mode),
        distinctUntilChanged()
      ),
    ])
      .pipe(
        map(([devInInstance, sleepMode]) => devInInstance && sleepMode),
        distinctUntilChanged(),
        debounceTime(2000),
        switchMap(async (condition) => {
          if (condition) await sleep(1000 * 60 * 5);
          return condition;
        }),
        filter(Boolean),
        tap(() => debug('[Steam] DEV_SLEEP achievement triggered')),
        switchMap(() => this.unlockAchievement(SteamAchievements.DEV_SLEEP))
      )
      .subscribe();
  }

  private async handleAchievement_CONNECT_HASS() {
    this.mqttService.clientStatus
      .pipe(
        distinctUntilChanged(),
        debounceTime(1000),
        filter((status) => status === 'CONNECTED'),
        switchMap(() => this.unlockAchievement(SteamAchievements.HASS_CON)),
        filter(Boolean),
        take(1)
      )
      .subscribe();
  }
}
