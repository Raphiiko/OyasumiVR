import { Component, DestroyRef, OnInit } from '@angular/core';
import { fadeUp, vshrink } from '../../utils/animations';
import { BaseModalComponent } from '../base-modal/base-modal.component';
import { ModalOptions } from '../../services/modal.service';
import { HardwareBrightnessControlService } from '../../services/brightness-control/hardware-brightness-control.service';
import { SoftwareBrightnessControlService } from '../../services/brightness-control/software-brightness-control.service';
import { SimpleBrightnessControlService } from '../../services/brightness-control/simple-brightness-control.service';
import { AutomationConfigService } from '../../services/automation-config.service';
import { asyncScheduler, filter, map, Subject, switchMap, tap, throttleTime } from 'rxjs';
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
  hardwareBrightnessBounds = [0, 100];
  advancedMode = false;
  driverAvailable = false;
  driverChecked = false;

  protected readonly setHardwareBrightness = new Subject<number>();
  protected readonly setSoftwareBrightness = new Subject<number>();
  protected readonly setSimpleBrightness = new Subject<number>();

  constructor(
    protected hardwareBrightnessControl: HardwareBrightnessControlService,
    protected softwareBrightnessControl: SoftwareBrightnessControlService,
    protected simpleBrightnessControl: SimpleBrightnessControlService,
    protected router: Router,
    public automationConfigService: AutomationConfigService,
    private destroyRef: DestroyRef
  ) {
    super();
    automationConfigService.configs
      .pipe(
        map((configs) => configs.BRIGHTNESS_AUTOMATIONS.advancedMode),
        takeUntilDestroyed()
      )
      .subscribe((advancedMode) => (this.advancedMode = advancedMode));
    hardwareBrightnessControl.driverIsAvailable
      .pipe(
        takeUntilDestroyed(),
        tap((available) => {
          if (!available) this.driverChecked = true;
          this.driverAvailable = available;
        }),
        filter(Boolean),
        switchMap(() => this.hardwareBrightnessControl.brightnessBounds),
        tap(() => (this.driverChecked = true))
      )
      .subscribe((bounds) => (this.hardwareBrightnessBounds = bounds));
    this.setHardwareBrightness
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        throttleTime(1000 / 30, asyncScheduler, { leading: true, trailing: true }),
        switchMap((percentage) => this.hardwareBrightnessControl.setBrightness(percentage))
      )
      .subscribe();
    this.setSoftwareBrightness
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        throttleTime(1000 / 30, asyncScheduler, { leading: true, trailing: true }),
        switchMap((percentage) => this.softwareBrightnessControl.setBrightness(percentage))
      )
      .subscribe();
    this.setSimpleBrightness
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        throttleTime(1000 / 30, asyncScheduler, { leading: true, trailing: true }),
        switchMap((percentage) => this.simpleBrightnessControl.setBrightness(percentage))
      )
      .subscribe();
  }

  ngOnInit(): void {}

  override getOptionsOverride(): Partial<ModalOptions> {
    return {
      wrapperDefaultClass: 'modal-wrapper-brightness-control',
    };
  }
}
