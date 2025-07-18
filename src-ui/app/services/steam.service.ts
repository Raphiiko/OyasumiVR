import { Injectable } from '@angular/core';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
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
import { debug, error, info } from '@tauri-apps/plugin-log';
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
    if (FLAVOUR !== 'STEAM' && FLAVOUR !== 'STEAM_CN' && FLAVOUR !== 'DEV') return;
    // Keep track of Steamworks status
    await this.getSteamActive();
    await listen<boolean>('STEAMWORKS_READY', (data) => this._active.next(data.payload));
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
    const active = await invoke<boolean>('steam_active');
    this._active.next(active);
    return active;
  }

  public async setAchievement(achievementId: string, unlocked: boolean): Promise<void> {
    if (!this._active) throw 'STEAMWORKS_INACTIVE';
    if (unlocked) info('[Steam] Unlocking achievement: ' + achievementId);
    else info('[Steam] Locking achievement: ' + achievementId);
    return invoke('steam_achievement_set', { achievementId, unlocked });
  }

  public async getAchievement(achievementId: string): Promise<boolean> {
    if (!this._active) throw 'STEAMWORKS_INACTIVE';
    return invoke<boolean>('steam_achievement_get', { achievementId });
  }

  // ACHIEVEMENT HANDLERS
  private async handleAchievement_START_OYASUMIVR() {
    // Set START_OYASUMIVR achievement when Steamworks becomes active
    this.active
      .pipe(
        distinctUntilChanged(),
        filter(Boolean),
        switchMap(() => this.getAchievement(SteamAchievements.START_OYASUMIVR)),
        filter((unlocked) => !unlocked),
        switchMap(() => this.setAchievement(SteamAchievements.START_OYASUMIVR, true)),
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
        switchMap(() => this.getAchievement(SteamAchievements.SMSPAM)),
        filter((unlocked) => !unlocked),
        switchMap(() => this.setAchievement(SteamAchievements.SMSPAM, true))
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
        switchMap(() => this.getAchievement(SteamAchievements.SLEEP_8H)),
        filter((unlocked) => !unlocked),
        switchMap(() => this.setAchievement(SteamAchievements.SLEEP_8H, true))
      )
      .subscribe();
  }

  private async handleAchievement_QUICK_EEPER() {
    this.sleep.onSleepModeChange
      .pipe(
        filter((change) => {
          return (
            change.mode === true &&
            change.reason.type === 'AUTOMATION' &&
            change.reason.automation === 'SLEEP_MODE_ENABLE_FOR_SLEEP_DETECTOR'
          );
        }),
        switchMap(() => this.vrchat.vrchatProcessActive.pipe(take(1))),
        filter(Boolean),
        switchMap(() =>
          this.vrchat.world.pipe(
            map((world) => world.joinedAt ?? null),
            take(1)
          )
        ),
        filter(Boolean),
        filter((timestamp) => Date.now() - timestamp < 1000 * 60 * 20),
        tap(() => debug('[Steam] QUICK_EEPER achievement triggered')),
        switchMap(() => this.getAchievement(SteamAchievements.QUICK_EEPER)),
        filter((unlocked) => !unlocked),
        switchMap(() => this.setAchievement(SteamAchievements.QUICK_EEPER, true))
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
        switchMap(() => this.getAchievement(SteamAchievements.DEV_SLEEP)),
        filter((unlocked) => !unlocked),
        switchMap(() => this.setAchievement(SteamAchievements.DEV_SLEEP, true))
      )
      .subscribe();
  }

  private async handleAchievement_CONNECT_HASS() {
    this.mqttService.clientStatus
      .pipe(
        distinctUntilChanged(),
        debounceTime(1000),
        filter((status) => status === 'CONNECTED'),
        switchMap(() => this.getAchievement(SteamAchievements.HASS_CON)),
        filter((unlocked) => !unlocked),
        switchMap(() => this.setAchievement(SteamAchievements.HASS_CON, true)),
        take(1)
      )
      .subscribe();
  }
}
