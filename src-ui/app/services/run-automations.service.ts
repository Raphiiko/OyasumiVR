import { Injectable } from '@angular/core';
import { AutomationConfigService } from './automation-config.service';
import { AUTOMATION_CONFIGS_DEFAULT, RunAutomationsConfig } from '../models/automations';
import { debounceTime, distinctUntilChanged, skip, take } from 'rxjs';
import { firstValueFrom } from 'rxjs';
import { debug, warn } from '@tauri-apps/plugin-log';
import { commands as coreCommands } from 'src-ui/app/bindings';
import { SleepService } from './sleep.service';
import { SleepPreparationService } from './sleep-preparation.service';
import { EventLogService } from './event-log.service';
import { EventLogFailure, EventLogRunAutomationExecuted } from '../models/event-log-entry';

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
      [automation + 'Commands']: commands,
    });
  }

  public async getCommands(
    automation: 'onSleepModeEnable' | 'onSleepModeDisable' | 'onSleepPreparation'
  ): Promise<string> {
    return (this.config[`${automation}Commands` as keyof RunAutomationsConfig] as string) ?? '';
  }

  public async testCommands(commands: string): Promise<void> {
    debug(`[RunAutomationsService] Testing commands:\n${commands}`);
    const result = await coreCommands.runCmdCommands(commands);
    if (result.status === 'error') {
      warn(`[RunAutomationsService] Failed to test commands: ${result.error}`);
    }
  }

  private async onSleepModeChange(sleepMode: boolean) {
    if (sleepMode && this.config.onSleepModeEnable) {
      await this.run('onSleepModeEnable', 'SLEEP_MODE_ENABLED');
    } else if (!sleepMode && this.config.onSleepModeDisable) {
      await this.run('onSleepModeDisable', 'SLEEP_MODE_DISABLED');
    }
  }

  private async onSleepPreparation() {
    if (this.config.onSleepPreparation) await this.run('onSleepPreparation', 'SLEEP_PREPARATION');
  }

  private async run(
    automationName: 'onSleepModeEnable' | 'onSleepModeDisable' | 'onSleepPreparation',
    reason: EventLogRunAutomationExecuted['reason']
  ) {
    const commands = (await this.getCommands(automationName)).trim();
    if (!commands) return;
    let failure: EventLogFailure | undefined;
    const result = await coreCommands.runCmdCommands(commands);
    if (result.status === 'error') {
      warn(`[RunAutomationsService] Failed to execute ${automationName} commands: ${result.error}`);
      failure = 'UNKNOWN';
    }
    this.eventLogService.logEvent({
      type: 'runAutomationExecuted',
      automationName,
      reason,
      commands,
      failure,
    });
  }
}
