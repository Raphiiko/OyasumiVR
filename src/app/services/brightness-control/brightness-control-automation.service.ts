import { Injectable } from '@angular/core';
import { AutomationConfigService } from '../automation-config.service';
import { SleepService } from '../sleep.service';
import { distinctUntilChanged, firstValueFrom, skip } from 'rxjs';
import { BrightnessControlService } from './brightness-control.service';

@Injectable({
  providedIn: 'root',
})
export class BrightnessControlAutomationService {
  constructor(
    private automationConfigService: AutomationConfigService,
    private sleepService: SleepService,
    private brightnessControl: BrightnessControlService
  ) {}

  async init() {
    this.sleepService.mode
      .pipe(skip(1), distinctUntilChanged())
      .subscribe((sleepMode) => this.onSleepModeChange(sleepMode));
  }

  private async onSleepModeChange(sleepMode: boolean) {
    const config = await firstValueFrom(this.automationConfigService.configs).then((c) =>
      sleepMode
        ? c.DISPLAY_BRIGHTNESS_ON_SLEEP_MODE_ENABLE
        : c.DISPLAY_BRIGHTNESS_ON_SLEEP_MODE_DISABLE
    );
    if (!config.enabled) return;
    if (config.transition) {
      this.brightnessControl.transitionBrightness(
        config.brightness,
        config.transitionTime,
        'BRIGHTNESS_AUTOMATION'
      );
    } else {
      this.brightnessControl.setBrightness(config.brightness, 'BRIGHTNESS_AUTOMATION');
    }
  }
}
