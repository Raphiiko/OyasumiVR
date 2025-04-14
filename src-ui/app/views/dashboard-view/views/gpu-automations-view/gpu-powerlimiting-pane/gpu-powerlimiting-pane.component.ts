import { Component, OnInit } from '@angular/core';
import { GPUDevice, GPUPowerLimit } from '../../../../../models/gpu-device';
import { NvmlService } from '../../../../../services/nvml.service';
import { GpuAutomationsService } from '../../../../../services/gpu-automations.service';
import { debounceTime, firstValueFrom, Subject } from 'rxjs';
import { noop, vshrink } from '../../../../../utils/animations';
import { TString } from 'src-ui/app/models/translatable-string';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

@Component({
    selector: 'app-gpu-powerlimiting-pane',
    templateUrl: './gpu-powerlimiting-pane.component.html',
    styleUrls: ['./gpu-powerlimiting-pane.component.scss'],
    animations: [vshrink(), noop()],
    standalone: false
})
export class GpuPowerlimitingPaneComponent implements OnInit {
  protected panel: 'PREINIT' | 'INITIALIZING' | 'ERROR' | 'ENABLED' = 'PREINIT';
  protected disabledMessage: TString = '';
  protected gpuDevices: Array<GPUDevice & { selected: boolean }> = [];
  protected selectedGpu?: GPUDevice;
  protected onSleepEnableAutomationEnabled = false;
  protected powerLimitOnSleepEnable?: GPUPowerLimit;
  protected onSleepDisableAutomationEnabled = false;
  protected powerLimitOnSleepDisable?: GPUPowerLimit;
  protected readonly powerLimitChange: Subject<{
    automation: 'SLEEP_ENABLE' | 'SLEEP_DISABLE';
    limit: GPUPowerLimit;
  }> = new Subject();

  constructor(private nvml: NvmlService, protected gpuAutomations: GpuAutomationsService) {
    this.gpuAutomations.nvmlDevices.pipe(takeUntilDestroyed()).subscribe(async (devices) => {
      this.gpuDevices = devices;
      this.selectedGpu = devices.find((d) => d.selected);
      if (this.selectedGpu) {
        const config = await firstValueFrom(this.gpuAutomations.powerLimitsConfig);
        this.onSleepEnableAutomationEnabled = config.onSleepEnable.enabled;
        this.powerLimitOnSleepEnable = {
          default: config.onSleepEnable.resetToDefault,
          limit: config.onSleepEnable.powerLimit || this.selectedGpu.defaultPowerLimit || 0,
        };
        this.onSleepDisableAutomationEnabled = config.onSleepDisable.enabled;
        this.powerLimitOnSleepDisable = {
          default: config.onSleepDisable.resetToDefault,
          limit: config.onSleepDisable.powerLimit || this.selectedGpu.defaultPowerLimit || 0,
        };
      }
    });
    nvml.status.pipe(takeUntilDestroyed()).subscribe((status) => {
      switch (status) {
        case 'InitComplete':
          this.panel = 'ENABLED';
          break;
        case 'Initializing':
          this.disabledMessage = 'gpu-automations.powerLimiting.disabled.initializing';
          this.panel = 'INITIALIZING';
          break;
        case 'DriverNotLoaded':
          this.disabledMessage = {
            string: 'gpu-automations.powerLimiting.disabled.noNvidia',
            values: { code: 'DRIVER_NOT_LOADED' },
          };
          this.panel = 'ERROR';
          break;
        case 'LibLoadingError':
          this.disabledMessage = {
            string: 'gpu-automations.powerLimiting.disabled.noNvidia',
            values: { code: 'LIB_LOADING_ERROR' },
          };
          this.panel = 'ERROR';
          break;
        case 'NoPermission':
          this.disabledMessage = 'gpu-automations.powerLimiting.disabled.noPermission';
          this.panel = 'ERROR';
          break;
        case 'SidecarUnavailable':
          this.disabledMessage = 'gpu-automations.powerLimiting.disabled.noSidecar';
          this.panel = 'ERROR';
          break;
        case 'NvmlUnknownError':
        case 'UnknownError':
          this.disabledMessage = 'gpu-automations.powerLimiting.disabled.unknown';
          this.panel = 'ERROR';
          break;
      }
    });
    this.powerLimitChange
      .pipe(takeUntilDestroyed(), debounceTime(100))
      .subscribe(async ({ automation, limit }) => {
        switch (automation) {
          case 'SLEEP_ENABLE':
            await this.gpuAutomations.setSleepEnablePowerLimit(limit);
            break;
          case 'SLEEP_DISABLE':
            await this.gpuAutomations.setSleepDisablePowerLimit(limit);
            break;
        }
      });
  }

  async ngOnInit() {}
}
