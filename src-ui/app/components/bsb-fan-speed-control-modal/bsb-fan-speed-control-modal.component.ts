import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { fadeUp, hshrink, vshrink } from '../../utils/animations';
import { BaseModalComponent } from '../base-modal/base-modal.component';
import { ModalOptions } from '../../services/modal.service';
import { AppSettingsService } from '../../services/app-settings.service';
import { asyncScheduler, Subject, switchMap, tap, throttleTime } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { BigscreenBeyondFanAutomationService } from '../../services/hmd-specific-automations/bigscreen-beyond-fan-automation.service';

@Component({
  selector: 'app-bsb-fan-speed-control-modal',
  templateUrl: './bsb-fan-speed-control-modal.component.html',
  styleUrls: ['./bsb-fan-speed-control-modal.component.scss'],
  animations: [fadeUp(), vshrink(), hshrink()],
  standalone: false,
})
export class BSBFanSpeedControlModalComponent
  extends BaseModalComponent<void, void>
  implements OnInit
{
  fanSpeedBounds = [40, 100];

  protected readonly setFanSpeed = new Subject<number>();

  constructor(
    protected fanControl: BigscreenBeyondFanAutomationService,
    protected router: Router,
    private appSettings: AppSettingsService,
    private cdr: ChangeDetectorRef
  ) {
    super();
    this.appSettings.settings
      .pipe(
        tap((settings) => {
          this.fanSpeedBounds = [settings.bigscreenBeyondAllowUnsafeFanSpeed ? 0 : 40, 100];
          this.cdr.markForCheck();
        }),
        takeUntilDestroyed()
      )
      .subscribe();
    this.setFanSpeed
      .pipe(
        throttleTime(1000 / 30, asyncScheduler, { leading: true, trailing: true }),
        switchMap((percentage) => this.fanControl.setFanSpeed(percentage)),
        takeUntilDestroyed()
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
