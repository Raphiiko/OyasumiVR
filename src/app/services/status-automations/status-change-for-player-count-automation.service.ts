import { Injectable } from '@angular/core';
import { VRChatService } from '../vrchat.service';
import {
  async,
  combineLatest,
  debounceTime,
  filter,
  map,
  pairwise,
  startWith,
  switchMap,
  throttleTime,
} from 'rxjs';
import { AutomationConfigService } from '../automation-config.service';
import { isEqual } from 'lodash';
import {
  AUTOMATION_CONFIGS_DEFAULT,
  ChangeStatusBasedOnPlayerCountAutomationConfig,
} from '../../models/automations';
import { SleepService } from '../sleep.service';
import { WorldContext } from '../../models/vrchat';
import { CurrentUser, UserStatus } from 'vrchat/dist';
import { info } from 'tauri-plugin-log-api';

@Injectable({
  providedIn: 'root',
})
export class StatusChangeForPlayerCountAutomationService {
  constructor(
    private vrchat: VRChatService,
    private automationConfig: AutomationConfigService,
    private sleep: SleepService
  ) {}

  async init() {
    combineLatest([
      this.vrchat.world.pipe(debounceTime(100)),
      this.sleep.mode,
      this.vrchat.user.pipe(filter((user) => !!user)),
      this.automationConfig.configs.pipe(
        map((c) => c.CHANGE_STATUS_BASED_ON_PLAYER_COUNT),
        startWith(AUTOMATION_CONFIGS_DEFAULT.CHANGE_STATUS_BASED_ON_PLAYER_COUNT),
        pairwise(),
        filter(([prev, next]) => !isEqual(prev, next)),
        map(([prev, next]) => next)
      ),
    ])
      .pipe(
        // Stop if automation is disabled
        filter(([worldContext, sleepModeEnabled, user, config]) => config.enabled),
        // Stop if sleep mode is disabled and it's required to be enabled
        filter(
          ([worldContext, sleepModeEnabled, user, config]) =>
            !config.onlyIfSleepModeEnabled || sleepModeEnabled
        ),
        // Determine new status to be set
        map(
          ([worldContext, _, user, config]: [
            WorldContext,
            boolean,
            CurrentUser | null,
            ChangeStatusBasedOnPlayerCountAutomationConfig
          ]) => ({
            newStatus:
              worldContext.playerCount < config.limit
                ? config.statusBelowLimit
                : config.statusAtLimitOrAbove,
            currentStatus: user!.status,
          })
        ),
        // Stop if status is already set or user is offline
        filter(
          ({ newStatus, currentStatus }) =>
            newStatus !== currentStatus && currentStatus !== UserStatus.Offline
        ),
        // Throttle to prevent spamming, just in case. (This should already be handled at the service level).
        throttleTime(500, async, { leading: true, trailing: true }),
        // Set the status
        switchMap(({ newStatus }) => {
          info(
            `[StatusChangeForPlayerCountAutomation] Detected changed conditions, setting new status...`
          );
          return this.vrchat.setStatus(newStatus);
        })
      )
      .subscribe();
  }
}
