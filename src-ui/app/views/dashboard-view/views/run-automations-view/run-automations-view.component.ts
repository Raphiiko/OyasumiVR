import { Component, DestroyRef, OnInit } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { vshrink } from '../../../../utils/animations';
import { AutomationConfigService } from '../../../../services/automation-config.service';
import { AUTOMATION_CONFIGS_DEFAULT, RunAutomationsConfig } from '../../../../models/automations';
import { RunAutomationsService } from 'src-ui/app/services/run-automations.service';
import { distinctUntilChanged, map, debounceTime, share, tap, switchMap, skip } from 'rxjs';
import { Subject } from 'rxjs';
import { isEqual } from 'lodash';

@Component({
  selector: 'app-run-automations-view',
  templateUrl: './run-automations-view.component.html',
  styleUrls: ['./run-automations-view.component.scss'],
  animations: [vshrink()],
  standalone: false,
})
export class RunAutomationsViewComponent implements OnInit {
  config: RunAutomationsConfig = structuredClone(AUTOMATION_CONFIGS_DEFAULT.RUN_AUTOMATIONS);
  onSleepModeEnableCommands: string = '';
  onSleepModeDisableCommands: string = '';
  onSleepPreparationCommands: string = '';

  // Collapse/expand state for each automation
  onSleepModeEnableExpanded: boolean = false;
  onSleepModeDisableExpanded: boolean = false;
  onSleepPreparationExpanded: boolean = false;

  private isInitialLoad: boolean = true;

  private onSleepModeEnableSubject = new Subject<string>();
  private onSleepModeDisableSubject = new Subject<string>();
  private onSleepPreparationSubject = new Subject<string>();

  constructor(
    private destroyRef: DestroyRef,
    private automationConfigService: AutomationConfigService,
    private runAutomationsService: RunAutomationsService
  ) { }

  ngOnInit(): void {
    const config = this.automationConfigService.configs
      .pipe(
        skip(1),
        takeUntilDestroyed(this.destroyRef),
        map((configs) => configs.RUN_AUTOMATIONS),
        distinctUntilChanged((a, b) => isEqual(a, b)),
        tap((config) => {
          this.config = config;
          // Initialize expanded states based on automation enabled state only on first load
          if (this.isInitialLoad) {
            this.onSleepModeEnableExpanded = config.onSleepModeEnable;
            this.onSleepModeDisableExpanded = config.onSleepModeDisable;
            this.onSleepPreparationExpanded = config.onSleepPreparation;
            this.isInitialLoad = false;
          }
        }),
        share(),
      );

    const events: ('onSleepModeEnable' | 'onSleepModeDisable' | 'onSleepPreparation')[] = ['onSleepModeEnable', 'onSleepModeDisable', 'onSleepPreparation'];
    for (const event of events) {
      config.pipe(
        switchMap(() => this.runAutomationsService.getCommands(event)),
        distinctUntilChanged(),
        takeUntilDestroyed(this.destroyRef),
      ).subscribe(command => {
        this[`${event}Commands` as keyof Pick<RunAutomationsViewComponent, 'onSleepModeEnableCommands' | 'onSleepModeDisableCommands' | 'onSleepPreparationCommands'>] = command;
      })
    }

    // Set up debounced command updates
    this.onSleepModeEnableSubject
      .pipe(
        debounceTime(1000),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(async (value) => {
        await this.runAutomationsService.updateCommands('onSleepModeEnable', value);
      });

    this.onSleepModeDisableSubject
      .pipe(
        debounceTime(1000),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(async (value) => {
        await this.runAutomationsService.updateCommands('onSleepModeDisable', value);
      });

    this.onSleepPreparationSubject
      .pipe(
        debounceTime(1000),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(async (value) => {
        await this.runAutomationsService.updateCommands('onSleepPreparation', value);
      });
  }

  toggleSleepModeEnable(): void {
    const newValue = !this.config.onSleepModeEnable;
    this.automationConfigService.updateAutomationConfig<RunAutomationsConfig>('RUN_AUTOMATIONS', {
      onSleepModeEnable: newValue,
    });

    // Auto expand when enabled, auto collapse when disabled
    if (newValue && !this.onSleepModeEnableExpanded) {
      this.onSleepModeEnableExpanded = true;
    } else if (!newValue && this.onSleepModeEnableExpanded) {
      this.onSleepModeEnableExpanded = false;
    }
  }

  async updateOnSleepModeEnable(value: string): Promise<void> {
    if (this.onSleepModeEnableCommands === value) return;
    this.onSleepModeEnableCommands = value;
    this.onSleepModeEnableSubject.next(value);
  }

  toggleSleepModeDisable(): void {
    const newValue = !this.config.onSleepModeDisable;
    this.automationConfigService.updateAutomationConfig<RunAutomationsConfig>('RUN_AUTOMATIONS', {
      onSleepModeDisable: newValue,
    });

    // Auto expand when enabled, auto collapse when disabled
    if (newValue && !this.onSleepModeDisableExpanded) {
      this.onSleepModeDisableExpanded = true;
    } else if (!newValue && this.onSleepModeDisableExpanded) {
      this.onSleepModeDisableExpanded = false;
    }
  }

  async updateOnSleepModeDisable(value: string): Promise<void> {
    if (this.onSleepModeDisableCommands === value) return;
    this.onSleepModeDisableCommands = value;
    this.onSleepModeDisableSubject.next(value);
  }

  toggleSleepPreparation(): void {
    const newValue = !this.config.onSleepPreparation;
    this.automationConfigService.updateAutomationConfig<RunAutomationsConfig>('RUN_AUTOMATIONS', {
      onSleepPreparation: newValue,
    });

    // Auto expand when enabled, auto collapse when disabled
    if (newValue && !this.onSleepPreparationExpanded) {
      this.onSleepPreparationExpanded = true;
    } else if (!newValue && this.onSleepPreparationExpanded) {
      this.onSleepPreparationExpanded = false;
    }
  }

  async updateOnSleepPreparation(value: string): Promise<void> {
    if (this.onSleepPreparationCommands === value) return;
    this.onSleepPreparationCommands = value;
    this.onSleepPreparationSubject.next(value);
  }

  async testCommands(commands: string): Promise<void> {
    await this.runAutomationsService.testCommands(commands);
  }
}
