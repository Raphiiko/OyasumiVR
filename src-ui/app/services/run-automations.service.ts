import { Injectable } from '@angular/core';
import { AutomationConfigService } from './automation-config.service';
import { AUTOMATION_CONFIGS_DEFAULT, RunAutomationsConfig } from '../models/automations';
import { debounceTime, distinctUntilChanged, skip, take } from 'rxjs';
import {
  decryptStorageData,
  deserializeStorageCryptoKey,
  encryptStorageData,
  generateStorageCryptoKey,
  serializeStorageCryptoKey,
} from '../utils/crypto';
import { firstValueFrom, ReplaySubject } from 'rxjs';
import { info, warn } from '@tauri-apps/plugin-log';
import { invoke } from '@tauri-apps/api/core';
import { SleepService } from './sleep.service';
import { SleepPreparationService } from './sleep-preparation.service';
import { EventLogService } from './event-log.service';

@Injectable({
  providedIn: 'root',
})
export class RunAutomationsService {
  private config: RunAutomationsConfig = structuredClone(
    AUTOMATION_CONFIGS_DEFAULT.RUN_AUTOMATIONS
  );
  private cryptoKey: ReplaySubject<CryptoKey> = new ReplaySubject<CryptoKey>(1);

  constructor(
    private automationsConfigService: AutomationConfigService,
    private sleepService: SleepService,
    private sleepPreparation: SleepPreparationService,
    private eventLogService: EventLogService
  ) { }

  async init() {
    this.config = (
      await firstValueFrom(this.automationsConfigService.configs.pipe(take(1)))
    ).RUN_AUTOMATIONS;
    const key = await this.getCryptoKey();
    this.cryptoKey.next(key);
    this.automationsConfigService.configs.subscribe((configs) => {
      this.config = configs.RUN_AUTOMATIONS;
    });
    // Subscribe to sleep events
    this.sleepService.mode
      .pipe(distinctUntilChanged(), skip(1), debounceTime(1000))
      .subscribe((sleepMode) => this.onSleepModeChange(sleepMode));
    this.sleepPreparation.onSleepPreparation.subscribe(() => this.onSleepPreparation());
  }

  public async updateCommands(
    automation: 'onSleepModeEnable' | 'onSleepModeDisable' | 'onSleepPreparation',
    commands: string
  ) {
    const key = await firstValueFrom(this.cryptoKey);
    const encryptedCommands = await encryptStorageData(commands, key);
    this.automationsConfigService.updateAutomationConfig<RunAutomationsConfig>('RUN_AUTOMATIONS', {
      [automation + 'Commands']: encryptedCommands,
    });
  }

  public async getCommands(
    automation: 'onSleepModeEnable' | 'onSleepModeDisable' | 'onSleepPreparation'
  ): Promise<string> {
    const key = await firstValueFrom(this.cryptoKey);
    const encryptedCommands = this.config[
      `${automation}Commands` as keyof RunAutomationsConfig
    ] as string;
    if (!encryptedCommands) return '';
    return await decryptStorageData(encryptedCommands, key);
  }

  public async testCommands(commands: string): Promise<void> {
    await invoke('run_cmd_commands', { commands });
  }

  private async onSleepModeChange(sleepMode: boolean) {
    if (sleepMode && this.config.onSleepModeEnableCommands) {
      const commands = await this.getCommands('onSleepModeEnable');
      if (commands.trim()) {
        try {
          await invoke('run_cmd_commands', { commands });
          this.eventLogService.logEvent({
            type: 'runAutomationExecuted',
            automationName: 'onSleepModeEnable',
            reason: 'SLEEP_MODE_ENABLED',
            commands: commands.trim(),
          } as any);
        } catch (error) {
          warn(`[RunAutomationsService] Failed to execute onSleepModeEnable commands: ${error}`);
        }
      }
    } else if (!sleepMode && this.config.onSleepModeDisableCommands) {
      const commands = await this.getCommands('onSleepModeDisable');
      if (commands.trim()) {
        try {
          await invoke('run_cmd_commands', { commands });
          this.eventLogService.logEvent({
            type: 'runAutomationExecuted',
            automationName: 'onSleepModeDisable',
            reason: 'SLEEP_MODE_DISABLED',
            commands: commands.trim(),
          } as any);
        } catch (error) {
          warn(`[RunAutomationsService] Failed to execute onSleepModeDisable commands: ${error}`);
        }
      }
    }
  }

  private async onSleepPreparation() {
    if (this.config.onSleepPreparation) {
      const commands = await this.getCommands('onSleepPreparation');
      if (commands.trim()) {
        try {
          await invoke('run_cmd_commands', { commands });
          this.eventLogService.logEvent({
            type: 'runAutomationExecuted',
            automationName: 'onSleepPreparation',
            reason: 'SLEEP_PREPARATION',
            commands: commands.trim(),
          } as any);
        } catch (error) {
          warn(`[RunAutomationsService] Failed to execute onSleepPreparation commands: ${error}`);
        }
      }
    }
  }

  private async getCryptoKey(): Promise<CryptoKey> {
    if (this.config.runAutomationsCryptoKey) {
      info('[RunAutomationsService] Using existing crypto key');
      return await deserializeStorageCryptoKey(this.config.runAutomationsCryptoKey);
    } else {
      info('[RunAutomationsService] Generating new crypto key');
      const key = await generateStorageCryptoKey();
      const wrappedKey = await serializeStorageCryptoKey(key);
      await this.automationsConfigService.updateAutomationConfig<RunAutomationsConfig>(
        'RUN_AUTOMATIONS',
        {
          runAutomationsCryptoKey: wrappedKey,
        }
      );
      return key;
    }
  }
}
