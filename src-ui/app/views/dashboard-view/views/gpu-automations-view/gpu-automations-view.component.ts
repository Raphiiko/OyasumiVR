import { Component, OnInit } from '@angular/core';
import { NvmlService, NvmlStatus } from '../../../../services/nvml.service';
import { asyncScheduler, combineLatest, firstValueFrom, map, Observable, throttleTime } from 'rxjs';
import { GpuAutomationsService } from '../../../../services/gpu-automations.service';
import { fade, hshrink, noop, vshrink } from 'src-ui/app/utils/animations';
import { ModalService } from 'src-ui/app/services/modal.service';
import { AppSettingsService } from '../../../../services/app-settings.service';
import { ElevatedSidecarService } from '../../../../services/elevated-sidecar.service';
import { ConfirmModalComponent } from '../../../../components/confirm-modal/confirm-modal.component';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ExecutableReferenceStatus } from 'src-ui/app/models/settings';
import { ActivatedRoute } from '@angular/router';

export type GpuAutomationsTab = 'POWER_LIMITS' | 'MSI_AFTERBURNER';

@Component({
  selector: 'app-gpu-automations-view',
  templateUrl: './gpu-automations-view.component.html',
  styleUrls: ['./gpu-automations-view.component.scss'],
  animations: [vshrink(), fade(), noop(), hshrink()],
  standalone: false,
})
export class GpuAutomationsViewComponent implements OnInit {
  protected activeTab: GpuAutomationsTab = 'POWER_LIMITS';
  panel: 'DISABLED' | 'NO_SIDECAR' | 'ENABLED' = 'DISABLED';
  disabledMessage = '';
  nvmlErrors?: Observable<boolean>;
  msiAfterburnerErrors?: Observable<boolean>;

  constructor(
    private nvml: NvmlService,
    protected gpuAutomations: GpuAutomationsService,
    private sidecar: ElevatedSidecarService,
    private modalService: ModalService,
    private settingsService: AppSettingsService,
    private activatedRoute: ActivatedRoute
  ) {
    combineLatest([sidecar.sidecarStarted, this.gpuAutomations.isEnabled()])
      .pipe(takeUntilDestroyed())
      .subscribe(([sidecarRunning, isEnabled]: [boolean, boolean]) => {
        if (!isEnabled) {
          this.disabledMessage = 'gpu-automations.disabled.disabled';
          return (this.panel = 'DISABLED');
        }
        if (!sidecarRunning) {
          this.disabledMessage = 'gpu-automations.disabled.noSidecar';
          return (this.panel = 'NO_SIDECAR');
        }
        return (this.panel = 'ENABLED');
      });
    this.nvmlErrors = combineLatest([this.gpuAutomations.isEnabled(), this.nvml.status]).pipe(
      throttleTime(300, asyncScheduler, { trailing: true, leading: true }),
      map(([gpuAutomationsEnabled, nvmlStatus]) => {
        if (!gpuAutomationsEnabled) return false;
        // Nvml
        if (
          (
            [
              'DriverNotLoaded',
              'LibLoadingError',
              'SidecarUnavailable',
              'NoPermission',
              'NvmlUnknownError',
              'UnknownError',
            ] as NvmlStatus[]
          ).includes(nvmlStatus)
        )
          return true;
        // No errors
        return false;
      })
    );
    this.msiAfterburnerErrors = combineLatest([
      this.gpuAutomations.isEnabled(),
      this.sidecar.sidecarStarted,
      this.gpuAutomations.msiAfterburnerStatus,
      this.gpuAutomations.msiAfterburnerConfig,
    ]).pipe(
      throttleTime(300, asyncScheduler, { trailing: true, leading: true }),
      map(([gpuAutomationsEnabled, sidecarRunning, msiAfterburnerStatus, msiAfterburnerConfig]) => {
        // Global
        if (!gpuAutomationsEnabled) return false;
        if (!sidecarRunning) return true;
        // Afterburner
        if (
          (msiAfterburnerConfig.onSleepDisableProfile > 0 ||
            msiAfterburnerConfig.onSleepEnableProfile > 0) &&
          (
            [
              'NOT_FOUND',
              'INVALID_EXECUTABLE',
              'PERMISSION_DENIED',
              'INVALID_FILENAME',
              'INVALID_SIGNATURE',
              'UNKNOWN_ERROR',
            ] as ExecutableReferenceStatus[]
          ).includes(msiAfterburnerStatus)
        )
          return true;
        // No errors found
        return false;
      })
    );
  }

  async ngOnInit() {
    const fragment = await firstValueFrom(this.activatedRoute.fragment);
    if (fragment) this.activeTab = fragment as GpuAutomationsTab;
  }

  async startSidecar() {
    if (!(await firstValueFrom(this.settingsService.settings)).askForAdminOnStart) {
      this.modalService
        .addModal(ConfirmModalComponent, {
          title: 'gpu-automations.elevationSidecarModal.title',
          message: 'gpu-automations.elevationSidecarModal.message',
          confirmButtonText: 'gpu-automations.elevationSidecarModal.confirm',
          cancelButtonText: 'gpu-automations.elevationSidecarModal.cancel',
        })
        .subscribe((data) => {
          if (data?.confirmed) {
            this.settingsService.updateSettings({ askForAdminOnStart: true });
          }
          this.sidecar.start();
        });
    } else {
      this.sidecar.start();
    }
  }
}
