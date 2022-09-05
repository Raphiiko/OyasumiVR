import { Component, OnDestroy, OnInit } from '@angular/core';
import { NVMLService, NVMLStatus } from '../../../../services/nvml.service';
import { WindowsService } from '../../../../services/windows.service';
import { combineLatest, firstValueFrom, Subject, takeUntil } from 'rxjs';
import { GpuAutomationService } from '../../../../services/gpu-automation.service';
import { GPUDevice, GPUPowerLimit } from '../../../../models/gpu-device';
import { fade, noop, vshrink } from 'src/app/utils/animations';

@Component({
  selector: 'app-gpu-automations-view',
  templateUrl: './gpu-automations-view.component.html',
  styleUrls: ['./gpu-automations-view.component.scss'],
  animations: [vshrink(), fade(), noop()],
})
export class GpuAutomationsViewComponent implements OnInit, OnDestroy {
  private destroy$: Subject<void> = new Subject<void>();
  panel: 'DISABLED' | 'NO_ELEVATION' | 'INITIALIZING' | 'NO_DEVICES' | 'ERROR' | 'ENABLED' =
    'DISABLED';
  disabledMessage: string = '';
  gpuDevices: Array<GPUDevice & { selected: boolean }> = [];
  selectedGpu?: GPUDevice;
  onSleepEnableAutomationEnabled: boolean = false;
  powerLimitOnSleepEnable?: GPUPowerLimit;
  onSleepDisableAutomationEnabled: boolean = false;
  powerLimitOnSleepDisable?: GPUPowerLimit;

  constructor(
    private nvml: NVMLService,
    public windows: WindowsService,
    public gpuAutomations: GpuAutomationService
  ) {
    this.gpuAutomations.devices.pipe(takeUntil(this.destroy$)).subscribe(async (devices) => {
      this.gpuDevices = devices;
      this.selectedGpu = devices.find((d) => d.selected);
      if (this.selectedGpu) {
        const config = await firstValueFrom(this.gpuAutomations.config);
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
    combineLatest([
      windows.isElevated,
      nvml.status,
      this.gpuAutomations.isEnabled(),
      this.gpuAutomations.devices,
    ])
      .pipe(takeUntil(this.destroy$))
      .subscribe(
        ([isElevated, nvmlStatus, isEnabled, devices]: [
          boolean,
          NVMLStatus,
          boolean,
          GPUDevice[]
        ]) => {
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
              if (!this.gpuDevices.length) {
                this.disabledMessage = 'gpu-automations.disabled.noDevices';
                return (this.panel = 'NO_DEVICES');
              }
              return (this.panel = 'ENABLED');
            case 'NVML_UNKNOWN_ERROR':
            case 'UNKNOWN_ERROR':
            default:
              this.disabledMessage = 'gpu-automations.disabled.unknown';
              return (this.panel = 'ERROR');
          }
        }
      );
  }

  async ngOnInit() {}

  async ngOnDestroy() {
    this.destroy$.next();
  }

  async onPowerLimitChange(automation: 'SLEEP_ENABLE' | 'SLEEP_DISABLE', limit: GPUPowerLimit) {
    switch (automation) {
      case 'SLEEP_ENABLE':
        await this.gpuAutomations.setSleepEnablePowerLimit(limit);
        break;
      case 'SLEEP_DISABLE':
        await this.gpuAutomations.setSleepDisablePowerLimit(limit);
        break;
    }
  }
}
