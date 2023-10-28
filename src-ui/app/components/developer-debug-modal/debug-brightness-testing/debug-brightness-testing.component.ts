import { Component, DestroyRef } from '@angular/core';
import { SimpleBrightnessControlService } from '../../../services/brightness-control/simple-brightness-control.service';
import { DisplayBrightnessControlService } from '../../../services/brightness-control/display-brightness-control.service';
import {
  DEFAULT_IMAGE_BRIGHTNESS_GAMMA,
  ImageBrightnessControlService,
} from '../../../services/brightness-control/image-brightness-control.service';
import { AutomationConfigService } from '../../../services/automation-config.service';
import { firstValueFrom, map, switchMap } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { SleepService } from '../../../services/sleep.service';

@Component({
  selector: 'app-debug-brightness-testing',
  templateUrl: './debug-brightness-testing.component.html',
  styleUrls: ['./debug-brightness-testing.component.scss'],
})
export class DebugBrightnessTestingComponent {
  public advancedMode = false;
  protected displayBrightnessBounds = this.displayBrightnessControl.driverIsAvailable.pipe(
    switchMap(() => this.displayBrightnessControl.getBrightnessBounds())
  );

  constructor(
    public simpleBrightnessControl: SimpleBrightnessControlService,
    public displayBrightnessControl: DisplayBrightnessControlService,
    public imageBrightnessControl: ImageBrightnessControlService,
    public automationConfigService: AutomationConfigService,
    public sleepService: SleepService,
    private destroyRef: DestroyRef
  ) {
    automationConfigService.configs
      .pipe(
        map((configs) => configs.BRIGHTNESS_CONTROL_ADVANCED_MODE),
        takeUntilDestroyed()
      )
      .subscribe((advancedMode) => (this.advancedMode = advancedMode.enabled));
  }

  togglePerceivedBrightnessAdjustment() {
    if (this.imageBrightnessControl.perceivedBrightnessAdjustmentGamma === null) {
      this.imageBrightnessControl.perceivedBrightnessAdjustmentGamma =
        DEFAULT_IMAGE_BRIGHTNESS_GAMMA;
    } else {
      this.imageBrightnessControl.perceivedBrightnessAdjustmentGamma = null;
    }
  }

  async toggleSleepMode() {
    const sleepMode = await firstValueFrom(this.sleepService.mode);
    if (sleepMode) {
      await this.sleepService.disableSleepMode({ type: 'MANUAL' });
    } else {
      await this.sleepService.enableSleepMode({ type: 'MANUAL' });
    }
  }
}
