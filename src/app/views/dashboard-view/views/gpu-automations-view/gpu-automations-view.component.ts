import { ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { NVMLService, NVMLStatus } from '../../../../services/nvml.service';
import { WindowsService } from '../../../../services/windows.service';
import { combineLatest, of, Subject, takeUntil } from 'rxjs';
import { GpuAutomationService } from '../../../../services/gpu-automation.service';

@Component({
  selector: 'app-gpu-automations-view',
  templateUrl: './gpu-automations-view.component.html',
  styleUrls: ['./gpu-automations-view.component.scss'],
})
export class GpuAutomationsViewComponent implements OnInit, OnDestroy {
  panel: 'DISABLED' | 'NO_ELEVATION' | 'INITIALIZING' | 'ERROR' | 'ENABLED' = 'DISABLED';
  disabledMessage: string = '';
  private destroy$: Subject<void> = new Subject<void>();

  constructor(
    private nvml: NVMLService,
    public windows: WindowsService,
    public gpuAutomations: GpuAutomationService
  ) {
    combineLatest([windows.isElevated, nvml.status, this.gpuAutomations.isEnabled()])
      .pipe(takeUntil(this.destroy$))
      .subscribe(([isElevated, nvmlStatus, isEnabled]: [boolean, NVMLStatus, boolean]) => {
        if (!isEnabled) {
          this.disabledMessage = 'gpu-automations.disabled.disabled';
          return (this.panel = 'DISABLED');
        }
        if (!isElevated) {
          this.disabledMessage = 'gpu-automations.disabled.noElevation';
          return (this.panel = 'NO_ELEVATION');
        }
        switch (nvmlStatus) {
          case 'INITIALIZING':
            this.disabledMessage = 'gpu-automations.disabled.initializing';
            return (this.panel = 'INITIALIZING');
          case 'NO_PERMISSION':
            this.disabledMessage = 'gpu-automations.disabled.noElevation';
            return (this.panel = 'NO_ELEVATION');
          case 'DRIVER_NOT_LOADED':
            this.disabledMessage = 'gpu-automations.disabled.driverNotLoaded';
            return (this.panel = 'ERROR');
          case 'INIT_COMPLETE':
            return (this.panel = 'ENABLED');
          case 'NVML_UNKNOWN_ERROR':
          case 'UNKNOWN_ERROR':
          default:
            this.disabledMessage = 'gpu-automations.disabled.unknown';
            return (this.panel = 'ERROR');
        }
      });
  }

  async ngOnInit() {}

  async ngOnDestroy() {
    this.destroy$.next();
  }
}
