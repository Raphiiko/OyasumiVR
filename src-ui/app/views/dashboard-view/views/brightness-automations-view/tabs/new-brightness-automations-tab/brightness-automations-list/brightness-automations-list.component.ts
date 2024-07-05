import { Component, DestroyRef, EventEmitter, OnInit, Output } from '@angular/core';
import {
  AUTOMATION_CONFIGS_DEFAULT,
  BrightnessAutomationsConfig,
  BrightnessEvent,
} from '../../../../../../../models/automations';
import { AutomationConfigService } from '../../../../../../../services/automation-config.service';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';

@Component({
  selector: 'app-brightness-automations-list',
  templateUrl: './brightness-automations-list.component.html',
  styleUrls: ['./brightness-automations-list.component.scss'],
})
export class BrightnessAutomationsListComponent implements OnInit {
  protected config: BrightnessAutomationsConfig = structuredClone(
    AUTOMATION_CONFIGS_DEFAULT.BRIGHTNESS_AUTOMATIONS
  );
  @Output() editEvent = new EventEmitter<BrightnessEvent>();

  protected events: Array<{
    name: BrightnessEvent;
    inProgress: boolean;
    icon: string;
    iconFilled?: boolean;
  }> = [
    { name: 'SLEEP_MODE_ENABLE', inProgress: false, icon: 'bedtime' },
    { name: 'SLEEP_MODE_DISABLE', inProgress: false, icon: 'bedtime_off' },
    { name: 'SLEEP_PREPARATION', inProgress: false, icon: 'bed' },
    { name: 'AT_SUNSET', inProgress: false, icon: 'wb_twilight' },
    { name: 'AT_SUNRISE', inProgress: false, icon: 'wb_twilight', iconFilled: true },
  ];

  constructor(
    private automationConfigService: AutomationConfigService,
    private destroyRef: DestroyRef
  ) {}

  ngOnInit() {
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
