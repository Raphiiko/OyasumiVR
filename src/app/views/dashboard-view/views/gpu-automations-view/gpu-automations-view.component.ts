import { Component, OnDestroy, OnInit } from '@angular/core';
import { NVMLService, NVMLStatus } from '../../../../services/nvml.service';
import { combineLatest, filter, firstValueFrom, Subject, takeUntil } from 'rxjs';
import { GpuAutomationsService } from '../../../../services/gpu-automations.service';
import { GPUDevice, GPUPowerLimit } from '../../../../models/gpu-device';
import { fade, noop, vshrink } from 'src/app/utils/animations';
import { ElevatedSidecarService } from 'src/app/services/elevated-sidecar.service';
import { TimeEnableSleepModeModalComponent } from '../sleep-detection-view/time-enable-sleepmode-modal/time-enable-sleep-mode-modal.component';
import { SleepModeEnableAtTimeAutomationConfig } from '../../../../models/automations';
import { SimpleModalService } from 'ngx-simple-modal';
import { ConfirmModalComponent } from '../../../../components/confirm-modal/confirm-modal.component';
import { AppSettingsService } from '../../../../services/app-settings.service';

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
    protected gpuAutomations: GpuAutomationsService,
    private sidecar: ElevatedSidecarService,
    private modalService: SimpleModalService,
    private settingsService: AppSettingsService
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
      sidecar.sidecarRunning,
      nvml.status,
      this.gpuAutomations.isEnabled(),
      this.gpuAutomations.devices,
    ])
      .pipe(takeUntil(this.destroy$))
      .subscribe(
        ([sidecarRunning, nvmlStatus, isEnabled, devices]: [
          boolean,
          NVMLStatus,
          boolean,
          GPUDevice[]
        ]) => {
          if (!isEnabled) {
            this.disabledMessage = 'gpu-automations.disabled.disabled';
            return (this.panel = 'DISABLED');
          }
          if (!sidecarRunning) {
            this.disabledMessage = 'gpu-automations.disabled.noElevation';
            return (this.panel = 'NO_ELEVATION');
          }
          switch (nvmlStatus) {
            case 'INITIALIZING':
              this.disabledMessage = 'gpu-automations.disabled.initializing';
              return (this.panel = 'INITIALIZING');
            case 'ELEVATION_SIDECAR_INACTIVE':
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
