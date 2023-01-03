import { Component, OnDestroy, OnInit } from '@angular/core';
import { NVMLService, NVMLStatus } from '../../../../services/nvml.service';
import { combineLatest, firstValueFrom, Subject, takeUntil } from 'rxjs';
import { GpuAutomationsService } from '../../../../services/gpu-automations.service';
import { GPUDevice, GPUPowerLimit } from '../../../../models/gpu-device';
import { fade, noop, vshrink } from 'src/app/utils/animations';
import { SimpleModalService } from 'ngx-simple-modal';
import { AppSettingsService } from '../../../../services/app-settings.service';
import { ElevatedSidecarService } from '../../../../services/elevated-sidecar.service';
import { ConfirmModalComponent } from '../../../../components/confirm-modal/confirm-modal.component';

@Component({
  selector: 'app-gpu-automations-view',
  templateUrl: './gpu-automations-view.component.html',
  styleUrls: ['./gpu-automations-view.component.scss'],
  animations: [vshrink(), fade(), noop()],
})
export class GpuAutomationsViewComponent implements OnInit, OnDestroy {
  private destroy$: Subject<void> = new Subject<void>();
  activeTab: 'POWER_LIMITS' | 'MSI_AFTERBURNER' = 'POWER_LIMITS';
  panel: 'DISABLED' | 'NO_SIDECAR' | 'ENABLED' = 'DISABLED';
  disabledMessage: string = '';

  constructor(
    private nvml: NVMLService,
    protected gpuAutomations: GpuAutomationsService,
    private sidecar: ElevatedSidecarService,
    private modalService: SimpleModalService,
    private settingsService: AppSettingsService
  ) {
    combineLatest([sidecar.sidecarRunning, this.gpuAutomations.isEnabled()])
      .pipe(takeUntil(this.destroy$))
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
  }

  async ngOnInit() {}

  async ngOnDestroy() {
    this.destroy$.next();
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
          if (data.confirmed) {
            this.settingsService.updateSettings({ askForAdminOnStart: true });
          }
          this.sidecar.start();
        });
    } else {
      this.sidecar.start();
    }
  }
}
