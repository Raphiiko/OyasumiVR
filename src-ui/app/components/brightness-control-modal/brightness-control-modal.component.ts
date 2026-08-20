import {
  ChangeDetectorRef,
  Component,
  DestroyRef,
  OnInit,
  ChangeDetectionStrategy,
} from '@angular/core';
import { fadeUp, hshrink, vshrink } from '../../utils/animations';
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
  animations: [fadeUp(), vshrink(), hshrink()],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false,
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
    private destroyRef: DestroyRef,
    private cdr: ChangeDetectorRef
  ) {
    super();
    automationConfigService.configs
      .pipe(
        map((configs) => configs.BRIGHTNESS_AUTOMATIONS.advancedMode),
        takeUntilDestroyed()
      )
      .subscribe((advancedMode) => {
        this.advancedMode = advancedMode;
        this.cdr.markForCheck();
      });
    hardwareBrightnessControl.driverIsAvailable
      .pipe(
        tap((available) => {
          if (!available) this.driverChecked = true;
          this.driverAvailable = available;
          this.cdr.markForCheck();
        }),
        filter(Boolean),
        switchMap(() => this.hardwareBrightnessControl.brightnessBounds),
        tap(() => {
          this.driverChecked = true;
          this.cdr.markForCheck();
        }),
        takeUntilDestroyed()
      )
      .subscribe((bounds) => {
        this.hardwareBrightnessBounds = bounds;
        this.cdr.markForCheck();
      });
    this.setHardwareBrightness
      .pipe(
        throttleTime(1000 / 30, asyncScheduler, { leading: true, trailing: true }),
        switchMap((percentage) => this.hardwareBrightnessControl.setBrightness(percentage)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
    this.setSoftwareBrightness
      .pipe(
        throttleTime(1000 / 30, asyncScheduler, { leading: true, trailing: true }),
        switchMap((percentage) => this.softwareBrightnessControl.setBrightness(percentage)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
    this.setSimpleBrightness
      .pipe(
        throttleTime(1000 / 30, asyncScheduler, { leading: true, trailing: true }),
        switchMap((percentage) => this.simpleBrightnessControl.setBrightness(percentage)),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  ngOnInit(): void {}

  override getOptionsOverride(): Partial<ModalOptions> {
    return {
      wrapperDefaultClass: 'modal-wrapper-brightness-control',
    };
  }

  protected isActive(path: string) {
    return this.router.isActive(path, {
      paths: 'subset',
      queryParams: 'subset',
      fragment: 'ignored',
      matrixParams: 'ignored',
    });
  }
}
