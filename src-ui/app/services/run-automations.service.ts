import { Injectable } from '@angular/core';
import { AutomationConfigService } from './automation-config.service';
import { AUTOMATION_CONFIGS_DEFAULT, RunAutomationsConfig } from '../models/automations';
import { debounceTime, distinctUntilChanged, skip, take } from 'rxjs';
import { decryptStorageData, deserializeStorageCryptoKey } from '../utils/crypto';
import { protectSecret, unprotectSecret } from '../utils/secrets';
import { firstValueFrom } from 'rxjs';
import { debug, error, info, warn } from '@tauri-apps/plugin-log';
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

  constructor(
    private automationsConfigService: AutomationConfigService,
    private sleepService: SleepService,
    private sleepPreparation: SleepPreparationService,
    private eventLogService: EventLogService
  ) {}

  async init() {
    this.config = (
      await firstValueFrom(this.automationsConfigService.configs.pipe(take(1)))
    ).RUN_AUTOMATIONS;
    await this.migrateLegacyCommands();
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
    this.automationsConfigService.updateAutomationConfig<RunAutomationsConfig>('RUN_AUTOMATIONS', {
      [automation + 'Commands']: await protectSecret(commands),
    });
  }

  public async getCommands(
    automation: 'onSleepModeEnable' | 'onSleepModeDisable' | 'onSleepPreparation'
  ): Promise<string> {
    const protectedCommands = this.config[
      `${automation}Commands` as keyof RunAutomationsConfig
    ] as string;
    if (!protectedCommands) return '';
    try {
      return await unprotectSecret(protectedCommands);
    } catch (cause) {
      warn(`[RunAutomationsService] Failed to unlock ${automation} commands: ${cause}`);
      return '';
    }
  }

  public async testCommands(commands: string): Promise<void> {
    debug(`[RunAutomationsService] Testing commands:\n${commands}`);
    await invoke('run_cmd_commands', { commands });
  }

  private async onSleepModeChange(sleepMode: boolean) {
    if (sleepMode && this.config.onSleepModeEnable) {
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
    } else if (!sleepMode && this.config.onSleepModeDisable) {
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

  private async migrateLegacyCommands() {
    const legacyKey = this.config.runAutomationsCryptoKey;
    if (!legacyKey) return;
    info('[RunAutomationsService] Migrating commands to protected storage');
    const automations = ['onSleepModeEnable', 'onSleepModeDisable', 'onSleepPreparation'] as const;
    const patch: Partial<RunAutomationsConfig> = { runAutomationsCryptoKey: undefined };
    let key: CryptoKey | null = null;
    try {
      key = await deserializeStorageCryptoKey(legacyKey);
    } catch (cause) {
      error(`[RunAutomationsService] Failed to unlock legacy command key: ${cause}`);
    }
    for (const automation of automations) {
      const encryptedCommands = this.config[`${automation}Commands`];
      if (!key || !encryptedCommands) continue;
      try {
        patch[`${automation}Commands`] = await protectSecret(
          await decryptStorageData(encryptedCommands, key)
        );
      } catch (cause) {
        error(`[RunAutomationsService] Failed to migrate ${automation} commands: ${cause}`);
      }
    }
    await this.automationsConfigService.updateAutomationConfig<RunAutomationsConfig>(
      'RUN_AUTOMATIONS',
      patch
    );
    this.config = { ...this.config, ...patch };
  }
}
