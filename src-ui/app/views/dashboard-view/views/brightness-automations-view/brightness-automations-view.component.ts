import { Component } from '@angular/core';
import { AutomationConfigService } from '../../../../services/automation-config.service';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

@Component({
    selector: 'app-brightness-automations-view',
    templateUrl: './brightness-automations-view.component.html',
    styleUrls: ['./brightness-automations-view.component.scss'],
    standalone: false
})
export class BrightnessAutomationsViewComponent {
  advancedMode = false;

  constructor(private automationConfigService: AutomationConfigService) {
    this.automationConfigService.configs.pipe(takeUntilDestroyed()).subscribe((configs) => {
      this.advancedMode = configs.BRIGHTNESS_AUTOMATIONS.advancedMode;
    });
  }
}
