import { Injectable } from '@angular/core';
import { AutomationConfigService } from './automation-config.service';
import {
  BehaviorSubject,
  combineLatest,
  distinctUntilChanged,
  filter,
  firstValueFrom,
  map,
  Observable,
  pairwise,
  skip,
  startWith,
  switchMap,
  take,
  tap,
} from 'rxjs';
import {
  AUTOMATION_CONFIGS_DEFAULT,
  GPUPowerLimitsAutomationConfig,
  MSIAfterburnerAutomationConfig,
} from '../models/automations';
import { cloneDeep } from 'lodash';
import { GPUDevice, GPUPowerLimit } from '../models/gpu-device';
import { NVMLService } from './nvml.service';
import { NVMLDevice } from '../models/nvml-device';
import { SleepService } from './sleep.service';
import { error, info, warn } from 'tauri-plugin-log-api';
import { invoke } from '@tauri-apps/api/tauri';
import { ExecutableReferenceStatus } from '../models/settings';
import { ElevatedSidecarService } from './elevated-sidecar.service';

@Injectable({
  providedIn: 'root',
})
export class GpuAutomationsService {
  // Power limiting
  private currentPowerLimitsConfig: GPUPowerLimitsAutomationConfig = cloneDeep(
    AUTOMATION_CONFIGS_DEFAULT.GPU_POWER_LIMITS
  );
  public powerLimitsConfig: Observable<GPUPowerLimitsAutomationConfig> =
    this.automationConfig.configs.pipe(map((configs) => configs.GPU_POWER_LIMITS));
  private _nvmlDevices: BehaviorSubject<GPUDevice[]> = new BehaviorSubject<GPUDevice[]>([]);
  public nvmlDevices: Observable<Array<GPUDevice & { selected: boolean }>>;
  // MSI Afterburner
  private currentMSIAfterburnerConfig: MSIAfterburnerAutomationConfig = cloneDeep(
    AUTOMATION_CONFIGS_DEFAULT.MSI_AFTERBURNER
  );
  public msiAfterburnerConfig: Observable<MSIAfterburnerAutomationConfig> =
    this.automationConfig.configs.pipe(map((configs) => configs.MSI_AFTERBURNER));
  private _msiAfterburnerStatus: BehaviorSubject<ExecutableReferenceStatus> =
    new BehaviorSubject<ExecutableReferenceStatus>('UNKNOWN');
  public msiAfterburnerStatus: Observable<ExecutableReferenceStatus> =
    this._msiAfterburnerStatus.asObservable();

  constructor(
    private automationConfig: AutomationConfigService,
    private nvml: NVMLService,
    private sleep: SleepService,
    private sidecar: ElevatedSidecarService
  ) {
    this.powerLimitsConfig.subscribe((config) => (this.currentPowerLimitsConfig = config));
    this.msiAfterburnerConfig.subscribe((config) => (this.currentMSIAfterburnerConfig = config));
    this.nvmlDevices = combineLatest([
      this.automationConfig.configs.pipe(map((configs) => configs.GPU_POWER_LIMITS)),
      this._nvmlDevices,
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
          this._nvmlDevices.next(devices);
        })
      )
      .subscribe();
    // If no GPU is selected and GPUs are detected, select the first one by default.
    this._nvmlDevices.subscribe((devices) => {
      if (this.currentPowerLimitsConfig.selectedDeviceId === null) {
        const device = devices.find((d) => d.supportsPowerLimiting);
        if (device) this.selectPowerLimitingDevice(device);
      }
    });
    // Setup sleep based power limiting automations
    this.setupPowerLimitOnSleepAutomations();
    // Test MSI Afterburner executable reference
    this.testMSIAfterburnerPathWhenNeeded();
    // Setup sleep based msi afterburner automations
    this.setupMSIAfterburnerProfileSleepAutomations();
  }

  isEnabled(): Observable<boolean> {
    return this.automationConfig.configs.pipe(
      map((configs) => configs.GPU_POWER_LIMITS.enabled && configs.MSI_AFTERBURNER.enabled)
    );
  }

  async enable() {
    await this.automationConfig.updateAutomationConfig<GPUPowerLimitsAutomationConfig>(
      'GPU_POWER_LIMITS',
      { ...cloneDeep(AUTOMATION_CONFIGS_DEFAULT.GPU_POWER_LIMITS), enabled: true }
    );
    await this.automationConfig.updateAutomationConfig<MSIAfterburnerAutomationConfig>(
      'MSI_AFTERBURNER',
      { ...cloneDeep(AUTOMATION_CONFIGS_DEFAULT.MSI_AFTERBURNER), enabled: true }
    );
    if (this.currentPowerLimitsConfig.selectedDeviceId === null) {
      const device = (this._nvmlDevices.value ?? []).find((d) => d.supportsPowerLimiting);
      if (device) this.selectPowerLimitingDevice(device);
    }
  }

  async disable() {
    await this.automationConfig.updateAutomationConfig<GPUPowerLimitsAutomationConfig>(
      'GPU_POWER_LIMITS',
      { ...cloneDeep(AUTOMATION_CONFIGS_DEFAULT.GPU_POWER_LIMITS), enabled: false }
    );
    await this.automationConfig.updateAutomationConfig<MSIAfterburnerAutomationConfig>(
      'MSI_AFTERBURNER',
      { ...cloneDeep(AUTOMATION_CONFIGS_DEFAULT.MSI_AFTERBURNER), enabled: false }
    );
  }

  async selectPowerLimitingDevice(device: GPUDevice) {
    if (device.id === this.currentPowerLimitsConfig.selectedDeviceId) return;

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
        ...cloneDeep(this.currentPowerLimitsConfig),
        onSleepEnable: {
          enabled: this.currentPowerLimitsConfig.onSleepEnable.enabled,
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
        ...cloneDeep(this.currentPowerLimitsConfig),
        onSleepDisable: {
          enabled: this.currentPowerLimitsConfig.onSleepDisable.enabled,
          powerLimit: limit.limit,
          resetToDefault: limit.default,
        },
      }
    );
  }

  async togglePowerLimitOnSleepEnabledAutomation() {
    const config = cloneDeep(this.currentPowerLimitsConfig);
    config.onSleepEnable.enabled = !config.onSleepEnable.enabled;
    await this.automationConfig.updateAutomationConfig<GPUPowerLimitsAutomationConfig>(
      'GPU_POWER_LIMITS',
      config
    );
  }

  async togglePowerLimitOnSleepDisabledAutomation() {
    const config = cloneDeep(this.currentPowerLimitsConfig);
    config.onSleepDisable.enabled = !config.onSleepDisable.enabled;
    await this.automationConfig.updateAutomationConfig<GPUPowerLimitsAutomationConfig>(
      'GPU_POWER_LIMITS',
      config
    );
  }

  private setupPowerLimitOnSleepAutomations() {
    const setupOnSleepAutomation = (on: 'ENABLE' | 'DISABLE') => {
      const getAutomationConfig = () => {
        switch (on) {
          case 'ENABLE':
            return this.currentPowerLimitsConfig.onSleepEnable;
          case 'DISABLE':
            return this.currentPowerLimitsConfig.onSleepDisable;
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
            this.nvmlDevices.pipe(
              take(1),
              map((devices) =>
                devices.find((d) => d.id === this.currentPowerLimitsConfig.selectedDeviceId)
              )
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

  async setupMSIAfterburnerProfileSleepAutomations() {
    this.sleep.mode
      .pipe(
        // Skip first value from initial load
        skip(1),
        // Only trigger on changes
        distinctUntilChanged(),
        // Check if GPU automations are enabled
        switchMap((sleepModeEnabled) =>
          this.isEnabled().pipe(
            take(1),
            map((gpuAutomationsEnabled) => [gpuAutomationsEnabled, sleepModeEnabled])
          )
        ),
        filter(([gpuAutomationsEnabled, _]) => gpuAutomationsEnabled),
        // Check profile to be enabled
        map(([_, sleepModeEnabled]) =>
          sleepModeEnabled
            ? this.currentMSIAfterburnerConfig.onSleepEnableProfile
            : this.currentMSIAfterburnerConfig.onSleepDisableProfile
        ),
        // Stop if no profile is to be enabled
        filter((profile) => profile > 0)
      )
      .subscribe((profile) => this.setMSIAfterburnerProfile(profile));
  }

  async testMSIAfterburnerPathWhenNeeded() {
    this.msiAfterburnerConfig
      .pipe(
        startWith(await firstValueFrom(this.msiAfterburnerConfig)),
        pairwise(),
        // Only if the status is still unknown, or if the path was changed (by the user)
        filter(
          ([prev, curr]) =>
            this._msiAfterburnerStatus.value === 'UNKNOWN' ||
            prev.msiAfterburnerPath !== curr.msiAfterburnerPath
        ),
        map(([_, curr]) => curr.msiAfterburnerPath),
        // Only while the sidecar is running
        switchMap((msiAfterburnerPath) =>
          this.sidecar.sidecarRunning.pipe(
            filter(Boolean),
            take(1),
            map(() => msiAfterburnerPath)
          )
        ),
        // Only while one of the profile automations is active (so we don't launch afterburner for nothing)
        switchMap((msiAfterburnerPath) =>
          this.msiAfterburnerConfig.pipe(
            filter((config) => !!(config.onSleepEnableProfile || config.onSleepDisableProfile)),
            take(1),
            map(() => msiAfterburnerPath)
          )
        )
      )
      .subscribe((msiAfterburnerPath) => {
        this.setMSIAfterburnerPath(msiAfterburnerPath, false);
      });
  }

  async setMSIAfterburnerProfile(index: number) {
    if (index < 1 || index > 5) {
      await error(`[GpuAutomations] Attempted to set invalid MSI Afterburner profile (${index})`);
      return;
    }
    if (this._msiAfterburnerStatus.value !== 'SUCCESS') {
      await warn(
        `[GpuAutomations] Could not set MSI Afterburner profile as no valid installation is currently configured`
      );
      return;
    }
    try {
      await invoke<boolean>('msi_afterburner_set_profile', {
        executablePath: this.currentMSIAfterburnerConfig.msiAfterburnerPath,
        profile: index,
      });
    } catch (e) {
      if (typeof e === 'string') {
        this.handleMSIAfterburnerError(e);
      } else {
        error('[GpuAutomations] Failed to set MSI Afterburner profile: ' + e);
        this._msiAfterburnerStatus.next('UNKNOWN_ERROR');
      }
      return;
    }
  }

  async setMSIAfterburnerPath(path: string, save: boolean = true) {
    if (save)
      await this.automationConfig.updateAutomationConfig<MSIAfterburnerAutomationConfig>(
        'MSI_AFTERBURNER',
        { msiAfterburnerPath: path }
      );
    this._msiAfterburnerStatus.next('CHECKING');
    if (!path.endsWith('MSIAfterburner.exe')) {
      this._msiAfterburnerStatus.next('NOT_FOUND');
      return;
    }
    // Try running it
    try {
      await invoke<boolean>('msi_afterburner_set_profile', {
        executablePath: path,
        profile: 0, // Profile 0 for testing without actually setting a profile
      });
    } catch (e) {
      if (typeof e === 'string') {
        this.handleMSIAfterburnerError(e);
      } else {
        error('[GpuAutomations] Failed to set MSI Afterburner path: ' + e);
        this._msiAfterburnerStatus.next('UNKNOWN_ERROR');
      }
      return;
    }
    this._msiAfterburnerStatus.next('SUCCESS');
  }

  async handleMSIAfterburnerError(e: string) {
    switch (e) {
      case 'EXE_NOT_FOUND':
        this._msiAfterburnerStatus.next('NOT_FOUND');
        break;
      case 'EXE_CANNOT_EXECUTE':
      case 'EXE_UNVERIFIABLE':
        this._msiAfterburnerStatus.next('INVALID_EXECUTABLE');
        break;
      case 'EXE_NOT_SIGNED':
      case 'EXE_SIGNATURE_DISALLOWED':
        this._msiAfterburnerStatus.next('INVALID_SIGNATURE');
        break;
      // Should never happen
      case 'INVALID_PROFILE_INDEX':
      case 'ELEVATED_SIDECAR_INACTIVE':
      case 'UNKNOWN_ERROR':
      default:
        this._msiAfterburnerStatus.next('UNKNOWN_ERROR');
        break;
    }
  }

  async setMSIAfterburnerProfileOnSleepEnable(number: number) {
    await this.automationConfig.updateAutomationConfig<MSIAfterburnerAutomationConfig>(
      'MSI_AFTERBURNER',
      { onSleepEnableProfile: number }
    );
  }

  async setMSIAfterburnerProfileOnSleepDisable(number: number) {
    await this.automationConfig.updateAutomationConfig<MSIAfterburnerAutomationConfig>(
      'MSI_AFTERBURNER',
      { onSleepDisableProfile: number }
    );
  }
}
