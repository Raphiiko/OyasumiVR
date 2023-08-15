import { Injectable } from '@angular/core';
import { invoke } from '@tauri-apps/api';
import { listen } from '@tauri-apps/api/event';
import { FLAVOUR } from '../../flavour';
import { BehaviorSubject, distinctUntilChanged, filter } from 'rxjs';
import { error, info } from 'tauri-plugin-log-api';

export const SteamAchievements = {
  START_OYASUMIVR: 'START_OYASUMIVR',
} as const;

@Injectable({
  providedIn: 'root',
})
export class SteamService {
  private readonly _active = new BehaviorSubject<boolean>(false);
  public readonly active = this._active.asObservable();

  constructor() {
    this.active
      .pipe(distinctUntilChanged(), filter(Boolean))
      .subscribe(() => info('[Steam] Steamworks SDK initialized'));
    // Set START_OYASUMIVR achievement when Steamworks becomes active
    this.active.pipe(distinctUntilChanged(), filter(Boolean)).subscribe(async () => {
      if (!(await this.getAchievement(SteamAchievements.START_OYASUMIVR))) {
        await this.setAchievement(SteamAchievements.START_OYASUMIVR, true);
      }
    });
  }

  public async init() {
    // Only run in Steam flavoured builds
    if (FLAVOUR !== 'STEAM') return;
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
}
