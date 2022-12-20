import { Injectable } from '@angular/core';
import { AutomationConfigService } from './automation-config.service';
import {
  BehaviorSubject,
  combineLatest,
  filter,
  map,
  Observable,
  skip,
  switchMap,
  take,
  tap,
} from 'rxjs';
import { AUTOMATION_CONFIGS_DEFAULT, GPUPowerLimitsAutomationConfig } from '../models/automations';
import { cloneDeep } from 'lodash';
import { GPUDevice, GPUPowerLimit } from '../models/gpu-device';
import { NVMLService } from './nvml.service';
import { NVMLDevice } from '../models/nvml-device';
import { SleepService } from './sleep.service';
import { info } from 'tauri-plugin-log-api';

@Injectable({
  providedIn: 'root',
})
export class GpuAutomationsService {
  private currentConfig: GPUPowerLimitsAutomationConfig = cloneDeep(
    AUTOMATION_CONFIGS_DEFAULT.GPU_POWER_LIMITS
  );
  public config: Observable<GPUPowerLimitsAutomationConfig> = this.automationConfig.configs.pipe(
    map((configs) => configs.GPU_POWER_LIMITS)
  );
  private _devices: BehaviorSubject<GPUDevice[]> = new BehaviorSubject<GPUDevice[]>([]);
  public devices: Observable<Array<GPUDevice & { selected: boolean }>>;

  constructor(
    private automationConfig: AutomationConfigService,
    private nvml: NVMLService,
    private sleep: SleepService
  ) {
    this.config.subscribe((config) => (this.currentConfig = config));
    this.devices = combineLatest([
      this.automationConfig.configs.pipe(map((configs) => configs.GPU_POWER_LIMITS)),
      this._devices,
    ]).pipe(
      map(([config, devices]) =>
        devices.map((d) => ({ ...d, selected: d.id === config.selectedDeviceId }))
      )
    );
  }
  async init() {
    // Process detected NVIDIA cards
    this.nvml.devices
      .pipe(
        tap((nvmlDevices) => {
          const devices = nvmlDevices.map((nd) => this.mapNVMLDeviceToGPUDevice(nd));
          this._devices.next(devices);
        })
      )
      .subscribe();
    // If no GPU is selected and GPUs are detected, select the first one by default.
    this._devices.subscribe((devices) => {
      if (this.currentConfig.selectedDeviceId === null && devices.length > 0) {
        this.selectDevice(devices[0]);
      }
    });
    // Setup sleep based GPU automations
    this.setupOnSleepAutomations();
  }

  isEnabled(): Observable<boolean> {
    return this.automationConfig.configs.pipe(map((configs) => configs.GPU_POWER_LIMITS.enabled));
  }

  async enable() {
    await this.automationConfig.updateAutomationConfig<GPUPowerLimitsAutomationConfig>(
      'GPU_POWER_LIMITS',
      { ...cloneDeep(AUTOMATION_CONFIGS_DEFAULT.GPU_POWER_LIMITS), enabled: true }
    );
    if (this._devices.value.length) await this.selectDevice(this._devices.value[0]);
  }

  async disable() {
    await this.automationConfig.updateAutomationConfig<GPUPowerLimitsAutomationConfig>(
      'GPU_POWER_LIMITS',
      { ...cloneDeep(AUTOMATION_CONFIGS_DEFAULT.GPU_POWER_LIMITS), enabled: false }
    );
  }

  async selectDevice(device: GPUDevice) {
    if (device.id === this.currentConfig.selectedDeviceId) return;

    await this.automationConfig.updateAutomationConfig<GPUPowerLimitsAutomationConfig>(
      'GPU_POWER_LIMITS',
      {
        selectedDeviceId: device.id,
        onSleepEnable: {
          ...cloneDeep(AUTOMATION_CONFIGS_DEFAULT.GPU_POWER_LIMITS.onSleepEnable),
          powerLimit: device.defaultPowerLimit,
        },
        onSleepDisable: {
          ...cloneDeep(AUTOMATION_CONFIGS_DEFAULT.GPU_POWER_LIMITS.onSleepDisable),
          powerLimit: device.defaultPowerLimit,
        },
      }
    );
  }

  async setSleepEnablePowerLimit(limit: GPUPowerLimit) {
    await this.automationConfig.updateAutomationConfig<GPUPowerLimitsAutomationConfig>(
      'GPU_POWER_LIMITS',
      {
        ...cloneDeep(this.currentConfig),
        onSleepEnable: {
          enabled: this.currentConfig.onSleepEnable.enabled,
          powerLimit: limit.limit,
          resetToDefault: limit.default,
        },
      }
    );
  }

  async setSleepDisablePowerLimit(limit: GPUPowerLimit) {
    await this.automationConfig.updateAutomationConfig<GPUPowerLimitsAutomationConfig>(
      'GPU_POWER_LIMITS',
      {
        ...cloneDeep(this.currentConfig),
        onSleepDisable: {
          enabled: this.currentConfig.onSleepDisable.enabled,
          powerLimit: limit.limit,
          resetToDefault: limit.default,
        },
      }
    );
  }

  async toggleOnSleepEnabledAutomation() {
    const config = cloneDeep(this.currentConfig);
    config.onSleepEnable.enabled = !config.onSleepEnable.enabled;
    await this.automationConfig.updateAutomationConfig<GPUPowerLimitsAutomationConfig>(
      'GPU_POWER_LIMITS',
      config
    );
  }

  async toggleOnSleepDisabledAutomation() {
    const config = cloneDeep(this.currentConfig);
    config.onSleepDisable.enabled = !config.onSleepDisable.enabled;
    await this.automationConfig.updateAutomationConfig<GPUPowerLimitsAutomationConfig>(
      'GPU_POWER_LIMITS',
      config
    );
  }

  private setupOnSleepAutomations() {
    const setupOnSleepAutomation = (on: 'ENABLE' | 'DISABLE') => {
      const getAutomationConfig = () => {
        switch (on) {
          case 'ENABLE':
            return this.currentConfig.onSleepEnable;
          case 'DISABLE':
            return this.currentConfig.onSleepDisable;
        }
      };
      this.sleep.mode
        .pipe(
          // Skip first value from initial load
          skip(1),
          // Trigger only on enable or disable
          filter((sleepMode) => {
            switch (on) {
              case 'ENABLE':
                return sleepMode;
              case 'DISABLE':
                return !sleepMode;
            }
          }),
          // Check if GPU automations are enabled
          switchMap((_) => this.isEnabled().pipe(take(1))),
          filter((gpuAutomationsEnabled) => gpuAutomationsEnabled),
          // Check if on sleep disable automation is enabled
          filter((_) => getAutomationConfig().enabled),
          // Fetch selected device
          switchMap((_) =>
            this.devices.pipe(
              take(1),
              map((devices) => devices.find((d) => d.id === this.currentConfig.selectedDeviceId))
            )
          ),
          // Check if selected device is available and supports power limiting
          filter((selectedDevice) => !!selectedDevice && !!selectedDevice.supportsPowerLimiting),
          switchMap((selectedDevice) => {
            info('[GpuAutomations] Setting power limit');
            return this.nvml.setPowerLimit(
              selectedDevice!.id,
              (getAutomationConfig().resetToDefault
                ? selectedDevice!.defaultPowerLimit!
                : getAutomationConfig().powerLimit || selectedDevice!.defaultPowerLimit!) * 1000
            );
          })
        )
        .subscribe();
    };
    setupOnSleepAutomation('ENABLE');
    setupOnSleepAutomation('DISABLE');
  }

  private mapNVMLDeviceToGPUDevice(nvmlDevice: NVMLDevice): GPUDevice {
    return {
      id: nvmlDevice.uuid,
      type: 'NVIDIA',
      name: nvmlDevice.name,
      supportsPowerLimiting:
        typeof nvmlDevice.minPowerLimit === 'number' &&
        typeof nvmlDevice.maxPowerLimit === 'number' &&
        typeof nvmlDevice.defaultPowerLimit === 'number' &&
        (nvmlDevice.minPowerLimit !== nvmlDevice.defaultPowerLimit ||
          nvmlDevice.maxPowerLimit !== nvmlDevice.defaultPowerLimit) &&
        nvmlDevice.maxPowerLimit > nvmlDevice.minPowerLimit,
      minPowerLimit:
        nvmlDevice.minPowerLimit !== undefined ? nvmlDevice.minPowerLimit / 1000 : undefined,
      maxPowerLimit:
        nvmlDevice.maxPowerLimit !== undefined ? nvmlDevice.maxPowerLimit / 1000 : undefined,
      defaultPowerLimit:
        nvmlDevice.defaultPowerLimit !== undefined
          ? nvmlDevice.defaultPowerLimit / 1000
          : undefined,
      powerLimit: nvmlDevice.powerLimit !== undefined ? nvmlDevice.powerLimit / 1000 : undefined,
    };
  }
}
