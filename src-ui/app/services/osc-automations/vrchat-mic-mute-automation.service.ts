import { Injectable } from '@angular/core';
import { OscService } from '../osc.service';
import {
  BehaviorSubject,
  delay,
  filter,
  firstValueFrom,
  interval,
  merge,
  of,
  skip,
  switchMap,
} from 'rxjs';
import { OSCBoolValue } from '../../models/osc-message';
import { AutomationConfigService } from '../automation-config.service';
import {
  AUTOMATION_CONFIGS_DEFAULT,
  VRChatMicMuteAutomationsConfig,
  VRChatMicMuteStateOption,
} from '../../models/automations';
import { isArray } from 'lodash';
import { SleepService } from '../sleep.service';
import { SleepPreparationService } from '../sleep-preparation.service';
import { EventLogService } from '../event-log.service';
import { EventLogChangedVRChatMicMuteState } from '../../models/event-log-entry';
import { info, warn } from '@tauri-apps/plugin-log';
import { fetch } from '@tauri-apps/plugin-http';
import { VRChatService } from '../vrchat-api/vrchat.service';

const READ_ADDR = '/avatar/parameters/MuteSelf';
const WRITE_ADDR = '/input/Voice';

@Injectable({
  providedIn: 'root',
})
export class VRChatMicMuteAutomationService {
  private _muted = new BehaviorSubject<boolean | null>(null);
  public muted = this._muted.asObservable();
  // Serializes the OSC button pulses, as two overlapping pulses read as a single press in VRChat.
  private muteQueue: Promise<void> = Promise.resolve();
  private vrcActive = false;
  private config: VRChatMicMuteAutomationsConfig = structuredClone(
    AUTOMATION_CONFIGS_DEFAULT.VRCHAT_MIC_MUTE_AUTOMATIONS
  );

  constructor(
    private osc: OscService,
    private automationConfigs: AutomationConfigService,
    private sleep: SleepService,
    private sleepPreparation: SleepPreparationService,
    private eventLog: EventLogService,
    private vrchat: VRChatService
  ) {}

  async init() {
    this.automationConfigs.configs.subscribe((configs) => {
      this.config = configs.VRCHAT_MIC_MUTE_AUTOMATIONS;
    });
    // Forget the muted state when VRChat stops, as the next session reports its own
    this.vrchat.vrchatProcessActive.subscribe((active) => {
      this.vrcActive = active;
      if (!active) this._muted.next(null);
    });
    // Listen for the muted state
    this.osc.messages.subscribe((message) => {
      if (message.address === READ_ADDR) {
        const value = message.values[0];
        if (value.kind === 'bool' && this.vrcActive) {
          const muted = (value as OSCBoolValue).value;
          this._muted.next(muted);
        }
      }
    });
    // Set the muted state when sleep mode changes
    this.sleep.mode.pipe(skip(1)).subscribe((mode) => {
      const option = mode ? this.config.onSleepModeEnable : this.config.onSleepModeDisable;
      this.applyAutomation(option, mode ? 'SLEEP_MODE_ENABLED' : 'SLEEP_MODE_DISABLED');
    });
    // Set the muted state when the user prepares to go to sleep
    this.sleepPreparation.onSleepPreparation.subscribe(() =>
      this.applyAutomation(this.config.onSleepPreparation, 'SLEEP_PREPARATION')
    );
    // In case the muted state is not known (This happens when OyasumiVR is launched after VRChat is already active)
    // We poll the muted state through OSCQuery every 3 seconds, until it is known.
    merge(interval(3000))
      .pipe(
        filter(() => this._muted.value === null),
        switchMap(() => this.fetchMutedState())
      )
      .subscribe();
  }

  async toggleMute(ensureStateKnown = true) {
    if (ensureStateKnown && !(await this.fetchMutedState())) return;
    await this.osc.send_int(WRITE_ADDR, 0);
    await firstValueFrom(of(null).pipe(delay(150)));
    await this.osc.send_int(WRITE_ADDR, 1);
    await firstValueFrom(of(null).pipe(delay(150)));
    await this.osc.send_int(WRITE_ADDR, 0);
    await firstValueFrom(of(null).pipe(delay(150)));
  }

  async setMute(state: boolean) {
    const run = this.muteQueue.then(async () => {
      if (this._muted.value !== state) {
        if (this._muted.value !== null) this._muted.next(state);
        await this.toggleMute(false);
      }
    });
    this.muteQueue = run.catch(() => undefined);
    return run;
  }

  private async applyAutomation(
    option: VRChatMicMuteStateOption,
    reason: EventLogChangedVRChatMicMuteState['reason']
  ) {
    if (option === 'NONE' || !this.vrcActive) return;
    const muted = option === 'MUTE';

    // the mic button is a toggle, so an unknown state cannot be set safely
    if (!(await this.fetchMutedState())) {
      if (!this.vrcActive) return;
      warn(
        `[VRChatMicMuteAutomation] Could not ${option.toLowerCase()} the microphone (${reason}): the muted state is unknown, as VRChat's OSCQuery did not report it`
      );
      this.eventLog.logEvent({
        type: 'changedVRChatMicMuteState',
        muted,
        reason,
        failure: 'STATE_UNKNOWN',
      } as EventLogChangedVRChatMicMuteState);
      return;
    }
    if (this._muted.value === muted) return;

    info(`[VRChatMicMuteAutomation] Setting the microphone to ${option} (${reason})`);
    this.eventLog.logEvent({
      type: 'changedVRChatMicMuteState',
      muted,
      reason,
    } as EventLogChangedVRChatMicMuteState);
    await this.setMute(muted);
  }

  private async fetchMutedState(): Promise<boolean> {
    if (this._muted.value !== null) return true;
    const oscqAddr = await firstValueFrom(this.osc.vrchatOscQueryAddress);
    if (!oscqAddr) return false;
    try {
      const resp = await fetch(`http://${oscqAddr}/avatar/parameters/MuteSelf`);
      const data: { VALUE?: boolean[] } = await resp.json().catch(() => {});
      // a newer state may have arrived during the read, so the read is stale
      if (this._muted.value !== null) return true;
      if (
        this.vrcActive &&
        data.VALUE &&
        isArray(data.VALUE) &&
        data.VALUE.length &&
        typeof data.VALUE[0] === 'boolean'
      ) {
        this._muted.next(Boolean(data.VALUE[0]));
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }
}
