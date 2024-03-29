import { Injectable } from '@angular/core';
import { OscService } from '../osc.service';
import {
  BehaviorSubject,
  debounceTime,
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
  VRChatVoiceMode,
} from '../../models/automations';
import { cloneDeep, isArray } from 'lodash';
import { SleepService } from '../sleep.service';
import { SleepPreparationService } from '../sleep-preparation.service';
import { EventLogService } from '../event-log.service';
import { EventLogChangedVRChatMicMuteState } from '../../models/event-log-entry';
import { info } from 'tauri-plugin-log-api';
import { Client, getClient } from '@tauri-apps/api/http';

const READ_ADDR = '/avatar/parameters/MuteSelf';
const WRITE_ADDR = '/input/Voice';

@Injectable({
  providedIn: 'root',
})
export class VRChatMicMuteAutomationService {
  private _muted = new BehaviorSubject<boolean | null>(null);
  public muted = this._muted.asObservable();
  private _mode = new BehaviorSubject<VRChatVoiceMode>(
    AUTOMATION_CONFIGS_DEFAULT.VRCHAT_MIC_MUTE_AUTOMATIONS.mode
  );
  public mode = this._mode.asObservable();
  private config: VRChatMicMuteAutomationsConfig = cloneDeep(
    AUTOMATION_CONFIGS_DEFAULT.VRCHAT_MIC_MUTE_AUTOMATIONS
  );
  private http!: Client;

  constructor(
    private osc: OscService,
    private automationConfigs: AutomationConfigService,
    private sleep: SleepService,
    private sleepPreparation: SleepPreparationService,
    private eventLog: EventLogService
  ) {}

  async init() {
    this.http = await getClient();

    this.automationConfigs.configs.subscribe((configs) => {
      this.config = configs.VRCHAT_MIC_MUTE_AUTOMATIONS;
      this._mode.next(this.config.mode);
    });
    // Listen for the muted state
    this.osc.messages.subscribe((message) => {
      if (message.address === READ_ADDR) {
        const value = message.values[0];
        if (value.kind === 'bool') {
          const muted = (value as OSCBoolValue).value;
          this._muted.next(muted);
        }
      }
    });
    // Set the muted state when sleep mode changes
    this.sleep.mode.pipe(skip(1)).subscribe(async (mode) => {
      let reason = null;
      let muted = false;
      if (mode && this.config.onSleepModeEnable !== 'NONE') {
        if (this.config.onSleepModeEnable === 'MUTE' && !this._muted.value) {
          reason = 'SLEEP_MODE_ENABLED';
          muted = true;
          info('[VRChatMicMuteAutomation] Muting microphone as the sleep mode was enabled');
          await this.setMute(true);
        } else if (this.config.onSleepModeEnable === 'UNMUTE' && this._muted.value) {
          reason = 'SLEEP_MODE_ENABLED';
          muted = false;
          info('[VRChatMicMuteAutomation] Unmuting microphone as the sleep mode was enabled');
          await this.setMute(false);
        }
      } else if (!mode && this.config.onSleepModeDisable !== 'NONE') {
        if (this.config.onSleepModeDisable === 'MUTE' && !this._muted.value) {
          reason = 'SLEEP_MODE_DISABLED';
          muted = true;
          info('[VRChatMicMuteAutomation] Muting microphone as the sleep mode was disabled');
          await this.setMute(true);
        } else if (this.config.onSleepModeDisable === 'UNMUTE' && this._muted.value) {
          reason = 'SLEEP_MODE_DISABLED';
          muted = false;
          info('[VRChatMicMuteAutomation] Unmuting microphone as the sleep mode was disabled');
          await this.setMute(false);
        }
      }
      if (reason) {
        this.eventLog.logEvent({
          type: 'changedVRChatMicMuteState',
          muted,
          reason,
        } as EventLogChangedVRChatMicMuteState);
      }
    });
    // Set the muted state when the user prepares to go to sleep
    this.sleepPreparation.onSleepPreparation.subscribe(async () => {
      if (this.config.onSleepPreparation !== 'NONE') {
        if (this.config.onSleepPreparation === 'MUTE' && !this._muted.value) {
          this.eventLog.logEvent({
            type: 'changedVRChatMicMuteState',
            muted: true,
            reason: 'SLEEP_PREPARATION',
          } as EventLogChangedVRChatMicMuteState);
          info('[VRChatMicMuteAutomation] Muting microphone as the user prepared to go to sleep');
          await this.setMute(true);
        } else if (this.config.onSleepPreparation === 'UNMUTE' && this._muted.value) {
          this.eventLog.logEvent({
            type: 'changedVRChatMicMuteState',
            muted: false,
            reason: 'SLEEP_PREPARATION',
          } as EventLogChangedVRChatMicMuteState);
          info('[VRChatMicMuteAutomation] Unmuting microphone as the user prepared to go to sleep');
          await this.setMute(false);
        }
      }
    });
    // In case the muted state is not known (This happens when OyasumiVR is launched after VRChat is already active)
    // We poll the muted state through OSCQuery every 3 seconds, until it is known.
    merge(interval(3000), this._mode.pipe(skip(1)))
      .pipe(
        debounceTime(100),
        filter(() => this._muted.value === null),
        switchMap(() => this.fetchMutedState())
      )
      .subscribe();
  }

  async setMode(mode: VRChatVoiceMode) {
    await this.automationConfigs.updateAutomationConfig<VRChatMicMuteAutomationsConfig>(
      'VRCHAT_MIC_MUTE_AUTOMATIONS',
      {
        mode,
      }
    );
  }

  async toggleMute(ensureStateKnown = true) {
    if (ensureStateKnown && !(await this.fetchMutedState())) return;
    switch (this._mode.value) {
      case 'TOGGLE':
        await this.osc.send_int(WRITE_ADDR, 0);
        await firstValueFrom(of(null).pipe(delay(150)));
        await this.osc.send_int(WRITE_ADDR, 1);
        await firstValueFrom(of(null).pipe(delay(150)));
        break;
      case 'PUSH_TO_MUTE':
        await this.osc.send_int(WRITE_ADDR, this._muted.value ? 0 : 1);
        await firstValueFrom(of(null).pipe(delay(150)));
        break;
    }
  }

  async setMute(state: boolean) {
    switch (this._mode.value) {
      case 'TOGGLE':
        if (this._muted.value !== state) {
          if (this._muted.value !== null) this._muted.next(state);
          await this.toggleMute(false);
        }
        break;
      case 'PUSH_TO_MUTE':
        if (this._muted.value !== null) this._muted.next(state);
        await this.osc.send_int(WRITE_ADDR, state ? 0 : 1);
        await firstValueFrom(of(null).pipe(delay(150)));
        break;
    }
  }

  private async fetchMutedState(): Promise<boolean> {
    if (this._muted.value !== null) return true;
    const oscqAddr = await firstValueFrom(this.osc.vrchatOscQueryAddress);
    if (!oscqAddr) return false;
    try {
      const resp = await this.http.get<{ VALUE?: boolean[] }>(
        `http://${oscqAddr}/avatar/parameters/MuteSelf`
      );
      if (
        resp.data.VALUE &&
        isArray(resp.data.VALUE) &&
        resp.data.VALUE.length &&
        typeof resp.data.VALUE[0] === 'boolean'
      ) {
        this._muted.next(Boolean(resp.data.VALUE[0]));
        return true;
      }
      return false;
    } catch (e) {
      console.warn(e);
      return false;
    }
  }
}
