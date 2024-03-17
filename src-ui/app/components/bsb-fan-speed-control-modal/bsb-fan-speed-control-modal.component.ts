import { Component, DestroyRef, OnInit } from '@angular/core';
import { fadeUp, vshrink } from '../../utils/animations';
import { BaseModalComponent } from '../base-modal/base-modal.component';
import { ModalOptions } from '../../services/modal.service';
import { AutomationConfigService } from '../../services/automation-config.service';
import {
  asyncScheduler,
  combineLatest,
  distinctUntilChanged,
  map,
  Subject,
  switchMap,
  tap,
  throttleTime,
} from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { BigscreenBeyondFanAutomationService } from '../../services/hmd-specific-automations/bigscreen-beyond-fan-automation.service';
import { HardwareBrightnessControlService } from '../../services/brightness-control/hardware-brightness-control.service';
import { AppSettingsService } from 'src-ui/app/services/app-settings.service';

@Component({
  selector: 'app-bsb-fan-speed-control-modal',
  templateUrl: './bsb-fan-speed-control-modal.component.html',
  styleUrls: ['./bsb-fan-speed-control-modal.component.scss'],
  animations: [fadeUp(), vshrink()],
})
export class BSBFanSpeedControlModalComponent
  extends BaseModalComponent<void, void>
  implements OnInit
{
  fanSpeedBounds = [40, 100];

  protected readonly destroy$ = new Subject<void>();
  protected readonly setFanSpeed = new Subject<number>();

  constructor(
    protected fanControl: BigscreenBeyondFanAutomationService,
    protected router: Router,
    public automationConfigService: AutomationConfigService,
    private destroyRef: DestroyRef,
    private appSettingsService: AppSettingsService
  ) {
    super();
  }

  ngOnInit(): void {
    this.automationConfigService.configs
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        map((c) => c.BIGSCREEN_BEYOND_FAN_CONTROL),
        tap((config) => (this.fanSpeedBounds = [config.allowUnsafeFanSpeed ? 0 : 40, 100]))
      )
      .subscribe();
    this.setFanSpeed
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        throttleTime(1000 / 30, asyncScheduler, { leading: true, trailing: true }),
        switchMap((percentage) => this.fanControl.setFanSpeed(percentage))
      )
      .subscribe();
  }

  override getOptionsOverride(): Partial<ModalOptions> {
    return {
      wrapperDefaultClass: 'modal-wrapper-brightness-control',
    };
  }
}
