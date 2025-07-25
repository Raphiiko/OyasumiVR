import { Component, DestroyRef, OnInit } from '@angular/core';
import { fadeUp, hshrink, vshrink } from '../../utils/animations';
import { BaseModalComponent } from '../base-modal/base-modal.component';
import { ModalOptions } from '../../services/modal.service';
import { AutomationConfigService } from '../../services/automation-config.service';
import { asyncScheduler, Subject, switchMap, throttleTime } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { CCTControlService } from '../../services/cct-control/cct-control.service';
import { AppSettingsService } from '../../services/app-settings.service';

@Component({
  selector: 'app-cct-control-modal',
  templateUrl: './cct-control-modal.component.html',
  styleUrls: ['./cct-control-modal.component.scss'],
  animations: [fadeUp(), vshrink(), hshrink()],
  standalone: false,
})
export class CCTControlModalComponent extends BaseModalComponent<void, void> implements OnInit {
  protected readonly setCCT = new Subject<number>();

  constructor(
    protected cctControl: CCTControlService,
    protected router: Router,
    public automationConfigService: AutomationConfigService,
    private destroyRef: DestroyRef,
    private appSettings: AppSettingsService
  ) {
    super();
    this.setCCT
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        throttleTime(1000 / 30, asyncScheduler, { leading: true, trailing: true }),
        switchMap((cct) => this.cctControl.setCCT(cct))
      )
      .subscribe();
  }

  async ngOnInit(): Promise<void> {
    await this.appSettings.promptDialogForOneTimeFlag('CCT_CONTROL_WARNING_DIALOG');
  }

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
