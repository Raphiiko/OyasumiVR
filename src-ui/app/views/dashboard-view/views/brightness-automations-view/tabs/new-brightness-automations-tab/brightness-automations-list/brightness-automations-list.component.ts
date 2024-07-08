import { Component, DestroyRef, EventEmitter, Input, OnInit, Output } from '@angular/core';
import {
  AUTOMATION_CONFIGS_DEFAULT,
  BrightnessAutomationsConfig,
  BrightnessEvent,
} from '../../../../../../../models/automations';
import { AutomationConfigService } from '../../../../../../../services/automation-config.service';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { combineLatest, map } from 'rxjs';
import { BrightnessCctAutomationService } from '../../../../../../../services/brightness-cct-automation.service';
import { fade } from '../../../../../../../utils/animations';
import { AppSettingsService } from '../../../../../../../services/app-settings.service';
import { BrightnessEventViewModel } from '../brightness-automations-tab.component';

@Component({
  selector: 'app-brightness-automations-list',
  templateUrl: './brightness-automations-list.component.html',
  styleUrls: ['./brightness-automations-list.component.scss'],
  animations: [fade()],
})
export class BrightnessAutomationsListComponent implements OnInit {
  protected config: BrightnessAutomationsConfig = structuredClone(
    AUTOMATION_CONFIGS_DEFAULT.BRIGHTNESS_AUTOMATIONS
  );
  @Input() events!: Array<BrightnessEventViewModel>;
  @Output() editEvent = new EventEmitter<BrightnessEventViewModel>();
  protected cctControlEnabled = false;

  constructor(
    private automationConfigService: AutomationConfigService,
    private brightnessCctAutomations: BrightnessCctAutomationService,
    private destroyRef: DestroyRef,
    private appSettingsService: AppSettingsService
  ) {}

  ngOnInit() {
    this.appSettingsService.settings
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((settings) => {
        this.cctControlEnabled = settings.cctControlEnabled;
      });
    this.events.forEach((event) => {
      combineLatest([
        this.brightnessCctAutomations.isBrightnessTransitionActive(event.name),
        this.brightnessCctAutomations.isCCTTransitionActive(event.name),
      ])
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe(([brightnessActive, cctActive]) => {
          event.inProgress = brightnessActive || cctActive;
        });
    });
    this.automationConfigService.configs
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        map((configs) => configs.BRIGHTNESS_AUTOMATIONS)
      )
      .subscribe((config) => {
        this.config = config;
      });
  }

  toggleEvent(name: BrightnessEvent) {
    this.automationConfigService.updateAutomationConfig('BRIGHTNESS_AUTOMATIONS', {
      [name]: { ...this.config[name], enabled: !this.config[name].enabled },
    });
  }
}
