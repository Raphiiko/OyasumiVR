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
import { cloneDeep } from 'lodash';
import { SleepService } from '../sleep.service';
import { SleepPreparationService } from '../sleep-preparation.service';

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

  constructor(
    private osc: OscService,
    private automationConfigs: AutomationConfigService,
    private sleep: SleepService,
    private sleepPreparation: SleepPreparationService
  ) {}

  async init() {
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
      if (mode && this.config.onSleepModeEnable !== 'NONE') {
        if (this.config.onSleepModeEnable === 'MUTE') {
          await this.setMute(true);
        } else if (this.config.onSleepModeEnable === 'UNMUTE') {
          await this.setMute(false);
        }
      } else if (!mode && this.config.onSleepModeDisable !== 'NONE') {
        if (this.config.onSleepModeDisable === 'MUTE') {
          await this.setMute(true);
        } else if (this.config.onSleepModeDisable === 'UNMUTE') {
          await this.setMute(false);
        }
      }
    });
    // Set the muted state when the user prepares to go to sleep
    this.sleepPreparation.onSleepPreparation.subscribe(async () => {
      if (this.config.onSleepPreparation !== 'NONE') {
        if (this.config.onSleepPreparation === 'MUTE') {
          await this.setMute(true);
        } else if (this.config.onSleepPreparation === 'UNMUTE') {
          await this.setMute(false);
        }
      }
    });
    // In case the muted state is not known (This happens when OyasumiVR is launched after VRChat is already active)
    // We try to determine the muted state by toggling the mute button twice until it is known
    merge(interval(5000), this._mode.pipe(skip(1)))
      .pipe(
        debounceTime(100),
        filter(() => this._muted.value === null),
        filter(() => this._mode.value === 'TOGGLE'),
        filter(
          () =>
            this.config.onSleepModeEnable !== 'NONE' ||
            this.config.onSleepModeDisable !== 'NONE' ||
            this.config.onSleepPreparation !== 'NONE'
        ),
        switchMap(() => this.ensureMutedStateKnown())
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
    if (ensureStateKnown && !(await this.ensureMutedStateKnown())) return;
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
          await this.toggleMute(false);
        }
        break;
      case 'PUSH_TO_MUTE':
        await this.osc.send_int(WRITE_ADDR, state ? 0 : 1);
        await firstValueFrom(of(null).pipe(delay(150)));
        break;
    }
  }

  private async ensureMutedStateKnown(): Promise<boolean> {
    if (this._muted.value !== null) return true;
    await this.setMute(false);
    await this.setMute(true);
    return this._muted.value !== null;
  }
}
