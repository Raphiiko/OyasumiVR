import { Component, OnInit } from '@angular/core';
import { fadeUp, vshrink } from '../../utils/animations';
import { BaseModalComponent } from '../base-modal/base-modal.component';
import { ModalOptions } from '../../services/modal.service';
import { DisplayBrightnessControlService } from '../../services/brightness-control/display-brightness-control.service';
import { ImageBrightnessControlService } from '../../services/brightness-control/image-brightness-control.service';
import { SimpleBrightnessControlService } from '../../services/brightness-control/simple-brightness-control.service';
import { AutomationConfigService } from '../../services/automation-config.service';
import { filter, map, switchMap, tap } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';

@Component({
  selector: 'app-brightness-control-modal',
  templateUrl: './brightness-control-modal.component.html',
  styleUrls: ['./brightness-control-modal.component.scss'],
  animations: [fadeUp(), vshrink()],
})
export class BrightnessControlModalComponent
  extends BaseModalComponent<void, void>
  implements OnInit
{
  displayBrightnessBounds = [0, 100];
  advancedMode = false;
  driverAvailable = false;

  constructor(
    protected displayBrightnessControl: DisplayBrightnessControlService,
    protected imageBrightnessControl: ImageBrightnessControlService,
    protected simpleBrightnessControl: SimpleBrightnessControlService,
    protected router: Router,
    public automationConfigService: AutomationConfigService
  ) {
    super();
    automationConfigService.configs
      .pipe(
        map((configs) => configs.BRIGHTNESS_CONTROL_ADVANCED_MODE),
        takeUntilDestroyed()
      )
      .subscribe((advancedMode) => (this.advancedMode = advancedMode.enabled));
    displayBrightnessControl.driverIsAvailable
      .pipe(
        takeUntilDestroyed(),
        tap((available) => (this.driverAvailable = available)),
        filter(Boolean),
        switchMap(() => this.displayBrightnessControl.getBrightnessBounds())
      )
      .subscribe((bounds) => (this.displayBrightnessBounds = bounds));
  }

  ngOnInit(): void {}

  override getOptionsOverride(): Partial<ModalOptions> {
    return {
      wrapperDefaultClass: 'modal-wrapper-brightness-control',
    };
  }
}
