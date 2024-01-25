import { Injectable } from '@angular/core';
import { invoke } from '@tauri-apps/api';
import { EventLogService } from './event-log.service';
import { EventLogWindowsPowerPolicySet } from '../models/event-log-entry';
import { error } from 'tauri-plugin-log-api';
import { BehaviorSubject } from 'rxjs';

interface WindowsPowerPolicy {
  guid: string;
  name: string;
}

@Injectable({
  providedIn: 'root',
})
export class WindowsService {
  private _policies = new BehaviorSubject<WindowsPowerPolicy[]>([]);
  public readonly policies = this._policies.asObservable();

  constructor(private eventLog: EventLogService) {}

  public async init() {
    await this.getWindowsPowerPolicies();
  }

  public async getWindowsPowerPolicies() {
    this._policies.next(await invoke<WindowsPowerPolicy[]>('get_windows_power_policies'));
    return this._policies.value;
  }

  public async setWindowsPowerPolicy(
    guid: string,
    reason: 'SLEEP_MODE_ENABLED' | 'SLEEP_MODE_DISABLED'
  ): Promise<void> {
    guid = guid.toUpperCase();
    await invoke<void>('set_windows_power_policy', { guid });
    const currentPolicy = await this.getWindowsPowerPolicy();
    if (currentPolicy?.guid !== guid) {
      error(
        `[Windows] Likely failed to set windows power policy: The newly fetched policy does not match the policy that was just set. (Set Policy = ${guid}, Actual Policy = ${currentPolicy?.name}, ${currentPolicy?.guid})`
      );
    } else if (currentPolicy) {
      this.eventLog.logEvent({
        type: 'windowsPowerPolicySet',
        reason,
        policyName: currentPolicy?.name ?? 'Unknown Policy',
      } as EventLogWindowsPowerPolicySet);
    }
  }

  public async getWindowsPowerPolicy(): Promise<WindowsPowerPolicy | undefined> {
    const policy =
      (await invoke<WindowsPowerPolicy | null>('active_windows_power_policy')) ?? undefined;
    // Update local policy cache
    if (policy) {
      const knownPolicy = this._policies.value.find((p) => p.guid === policy.guid);
      if (knownPolicy) Object.assign(knownPolicy, policy);
      else this._policies.value.push(policy);
      this._policies.next(this._policies.value);
    }
    return policy;
  }
}
