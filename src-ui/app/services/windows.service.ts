import { Injectable } from '@angular/core';
import { WindowsPowerPolicy } from '../models/windows-power-policy';
import { invoke } from '@tauri-apps/api';
import { EventLogService } from './event-log.service';
import { EventLogWindowsPowerPolicySet } from '../models/event-log-entry';
import { error } from 'tauri-plugin-log-api';

@Injectable({
  providedIn: 'root',
})
export class WindowsService {
  constructor(private eventLog: EventLogService) {}

  public async setWindowsPowerPolicy(
    policy: WindowsPowerPolicy,
    reason: 'SLEEP_MODE_ENABLED' | 'SLEEP_MODE_DISABLED'
  ): Promise<void> {
    await invoke<void>('set_windows_power_policy', { policy });
    const currentPolicy = await this.getWindowsPowerPolicy();
    if (currentPolicy !== policy) {
      error(
        `[Windows] Likely failed to set windows power policy: The newly fetched policy does not match the policy that was just set. (Set Policy = ${policy}, Actual Policy = ${currentPolicy})`
      );
    } else {
      this.eventLog.logEvent({
        type: 'windowsPowerPolicySet',
        policy,
        reason,
      } as EventLogWindowsPowerPolicySet);
    }
  }

  public async getWindowsPowerPolicy(): Promise<WindowsPowerPolicy | undefined> {
    return (
      (await invoke<WindowsPowerPolicy | undefined>('active_windows_power_policy')) ?? undefined
    );
  }
}
