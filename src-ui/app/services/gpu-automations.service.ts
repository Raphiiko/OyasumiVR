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

import { GPUDevice, GPUPowerLimit, GPUPowerLimitUnit } from '../models/gpu-device';
import { NvmlService } from './nvml.service';
import { NvmlDevice } from '../models/nvml-device';
import { SleepService } from './sleep.service';
import { error, info, warn } from '@tauri-apps/plugin-log';
import { invoke } from '@tauri-apps/api/core';
import { ExecutableReferenceStatus } from '../models/settings';
import { ElevatedSidecarService } from './elevated-sidecar.service';
import { EventLogService } from './event-log.service';
import {
  EventLogGpuPowerLimitChanged,
  EventLogMsiAfterburnerProfileSet,
} from '../models/event-log-entry';

const GPU_POWER_LIMIT_SCALE = 1000;
const ADLX_POWER_LIMIT_SHIFT_PERCENT = 100;

@Injectable({
  providedIn: 'root',
})
export class GpuAutomationsService {
  // Power limiting
  private currentPowerLimitsConfig: GPUPowerLimitsAutomationConfig = structuredClone(
    AUTOMATION_CONFIGS_DEFAULT.GPU_POWER_LIMITS
  );
  public powerLimitsConfig: Observable<GPUPowerLimitsAutomationConfig> =
    this.automationConfig.configs.pipe(map((configs) => configs.GPU_POWER_LIMITS));
  private _nvmlDevices: BehaviorSubject<GPUDevice[]> = new BehaviorSubject<GPUDevice[]>([]);
  public nvmlDevices: Observable<Array<GPUDevice & { selected: boolean }>>;
  // MSI Afterburner
  private currentMSIAfterburnerConfig: MSIAfterburnerAutomationConfig = structuredClone(
    AUTOMATION_CONFIGS_DEFAULT.MSI_AFTERBURNER
  );
  public msiAfterburnerConfig: Observable<MSIAfterburnerAutomationConfig> =
    this.automationConfig.configs.pipe(map((configs) => configs.MSI_AFTERBURNER));
  private _msiAfterburnerStatus: BehaviorSubject<ExecutableReferenceStatus> =
    new BehaviorSubject<ExecutableReferenceStatus>('UNKNOWN');
  public msiAfterburnerStatus: Observable<ExecutableReferenceStatus> =
    this._msiAfterburnerStatus.asObservable();
  private msiValidationGeneration = 0;
  private validatedMSIPath: string | undefined;

  constructor(
    private automationConfig: AutomationConfigService,
    private nvml: NvmlService,
    private sleep: SleepService,
    private sidecar: ElevatedSidecarService,
    private eventLog: EventLogService
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

  /** Subscribes once at startup to device discovery, default GPU selection, and sleep automations. */
  async init() {
    // Process detected GPUs from elevated sidecar backends (NVML/ADLX).
    this.nvml.devices
      .pipe(
        tap((nvmlDevices) => {
          const devices = nvmlDevices.map((nd) => this.mapNvmlDeviceToGPUDevice(nd));
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
      { ...structuredClone(AUTOMATION_CONFIGS_DEFAULT.GPU_POWER_LIMITS), enabled: true }
    );
    await this.automationConfig.updateAutomationConfig<MSIAfterburnerAutomationConfig>(
      'MSI_AFTERBURNER',
      { ...structuredClone(AUTOMATION_CONFIGS_DEFAULT.MSI_AFTERBURNER), enabled: true }
    );
    if (this.currentPowerLimitsConfig.selectedDeviceId === null) {
      const device = (this._nvmlDevices.value ?? []).find((d) => d.supportsPowerLimiting);
      if (device) this.selectPowerLimitingDevice(device);
    }
  }

  async disable() {
    await this.automationConfig.updateAutomationConfig<GPUPowerLimitsAutomationConfig>(
      'GPU_POWER_LIMITS',
      { ...structuredClone(AUTOMATION_CONFIGS_DEFAULT.GPU_POWER_LIMITS), enabled: false }
    );
    await this.automationConfig.updateAutomationConfig<MSIAfterburnerAutomationConfig>(
      'MSI_AFTERBURNER',
      { ...structuredClone(AUTOMATION_CONFIGS_DEFAULT.MSI_AFTERBURNER), enabled: false }
    );
  }

  async selectPowerLimitingDevice(device: GPUDevice) {
    if (device.id === this.currentPowerLimitsConfig.selectedDeviceId) return;

    await this.automationConfig.updateAutomationConfig<GPUPowerLimitsAutomationConfig>(
      'GPU_POWER_LIMITS',
      {
        selectedDeviceId: device.id,
        onSleepEnable: {
          ...structuredClone(AUTOMATION_CONFIGS_DEFAULT.GPU_POWER_LIMITS.onSleepEnable),
          powerLimit: device.defaultPowerLimit,
        },
        onSleepDisable: {
          ...structuredClone(AUTOMATION_CONFIGS_DEFAULT.GPU_POWER_LIMITS.onSleepDisable),
          powerLimit: device.defaultPowerLimit,
        },
      }
    );
  }

  async setSleepEnablePowerLimit(limit: GPUPowerLimit) {
    await this.automationConfig.updateAutomationConfig<GPUPowerLimitsAutomationConfig>(
      'GPU_POWER_LIMITS',
      {
        ...structuredClone(this.currentPowerLimitsConfig),
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
        ...structuredClone(this.currentPowerLimitsConfig),
        onSleepDisable: {
          enabled: this.currentPowerLimitsConfig.onSleepDisable.enabled,
          powerLimit: limit.limit,
          resetToDefault: limit.default,
        },
      }
    );
  }

  async togglePowerLimitOnSleepEnabledAutomation() {
    const config = structuredClone(this.currentPowerLimitsConfig);
    config.onSleepEnable.enabled = !config.onSleepEnable.enabled;
    await this.automationConfig.updateAutomationConfig<GPUPowerLimitsAutomationConfig>(
      'GPU_POWER_LIMITS',
      config
    );
  }

  async togglePowerLimitOnSleepDisabledAutomation() {
    const config = structuredClone(this.currentPowerLimitsConfig);
    config.onSleepDisable.enabled = !config.onSleepDisable.enabled;
    await this.automationConfig.updateAutomationConfig<GPUPowerLimitsAutomationConfig>(
      'GPU_POWER_LIMITS',
      config
    );
  }

  /** Applies enabled rules on sleep transitions, skipping initial state and logging only success. */
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
          switchMap(() => this.isEnabled().pipe(take(1))),
          filter((gpuAutomationsEnabled) => gpuAutomationsEnabled),
          // Check if on sleep disable automation is enabled
          filter(() => getAutomationConfig().enabled),
          // Fetch selected device
          switchMap(() =>
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
            const powerLimit = getAutomationConfig().resetToDefault
              ? selectedDevice!.defaultPowerLimit!
              : (this.normalizeConfiguredPowerLimit(
                  selectedDevice!,
                  getAutomationConfig().powerLimit
                ) ?? selectedDevice!.defaultPowerLimit!);
            return this.nvml
              .setPowerLimit(
                selectedDevice!.id,
                this.encodePowerLimitForCommand(selectedDevice!, powerLimit)
              )
              .then((success) => {
                if (!success) return;
                this.eventLog.logEvent({
                  type: 'gpuPowerLimitChanged',
                  device: selectedDevice!.name,
                  limit: powerLimit,
                  limitUnit: selectedDevice!.powerLimitUnit,
                  resetToDefault: getAutomationConfig().resetToDefault,
                  reason: on === 'ENABLE' ? 'SLEEP_MODE_ENABLED' : 'SLEEP_MODE_DISABLED',
                } as EventLogGpuPowerLimitChanged);
              });
          })
        )
        .subscribe();
    };
    setupOnSleepAutomation('ENABLE');
    setupOnSleepAutomation('DISABLE');
  }

  /** Decodes wire limits to AMD percentage offsets or NVIDIA watts and derives tuning support. */
  private mapNvmlDeviceToGPUDevice(nvmlDevice: NvmlDevice): GPUDevice {
    const isAdlxDevice = nvmlDevice.uuid.startsWith('adlx:');
    const powerLimitUnit: GPUPowerLimitUnit = isAdlxDevice ? '%' : 'W';
    const minPowerLimit = this.mapPowerLimitValue(nvmlDevice.minPowerLimit, isAdlxDevice);
    const maxPowerLimit = this.mapPowerLimitValue(nvmlDevice.maxPowerLimit, isAdlxDevice);
    const defaultPowerLimit = this.mapPowerLimitValue(nvmlDevice.defaultPowerLimit, isAdlxDevice);
    const powerLimit = this.mapPowerLimitValue(nvmlDevice.powerLimit, isAdlxDevice);

    return {
      id: nvmlDevice.uuid,
      type: isAdlxDevice ? 'AMD' : 'NVIDIA',
      powerLimitUnit,
      name: nvmlDevice.name,
      supportsPowerLimiting:
        typeof minPowerLimit === 'number' &&
        typeof maxPowerLimit === 'number' &&
        typeof defaultPowerLimit === 'number' &&
        (minPowerLimit !== defaultPowerLimit || maxPowerLimit !== defaultPowerLimit) &&
        maxPowerLimit > minPowerLimit,
      minPowerLimit,
      maxPowerLimit,
      defaultPowerLimit,
      powerLimit,
    };
  }

  /** Divides wire values by 1000 and removes AMD's +100 offset; missing readings stay undefined. */
  private mapPowerLimitValue(value: number | undefined, isAdlxDevice: boolean): number | undefined {
    if (value === undefined) return undefined;

    const scaledValue = value / GPU_POWER_LIMIT_SCALE;
    return isAdlxDevice ? scaledValue - ADLX_POWER_LIMIT_SHIFT_PERCENT : scaledValue;
  }

  /**
   * Keeps in-range AMD offsets; otherwise subtracts 100 and clamps to known driver bounds.
   * Missing values and NVIDIA watt limits pass through unchanged.
   */
  public normalizeConfiguredPowerLimit(
    device: GPUDevice,
    configuredLimit: number | undefined
  ): number | undefined {
    if (configuredLimit === undefined) return undefined;
    if (device.type !== 'AMD') return configuredLimit;

    const minPowerLimit = device.minPowerLimit;
    const maxPowerLimit = device.maxPowerLimit;
    if (
      typeof minPowerLimit === 'number' &&
      typeof maxPowerLimit === 'number' &&
      configuredLimit >= minPowerLimit &&
      configuredLimit <= maxPowerLimit
    ) {
      return configuredLimit;
    }

    const normalizedLimit = configuredLimit - ADLX_POWER_LIMIT_SHIFT_PERCENT;
    if (typeof minPowerLimit === 'number' && typeof maxPowerLimit === 'number') {
      return Math.min(Math.max(normalizedLimit, minPowerLimit), maxPowerLimit);
    }

    return normalizedLimit;
  }

  /** Encodes watts as milliwatts or AMD offsets as `(offset + 100) * 1000`, rounding down. */
  private encodePowerLimitForCommand(device: GPUDevice, powerLimit: number): number {
    if (device.type === 'AMD') {
      return Math.floor((powerLimit + ADLX_POWER_LIMIT_SHIFT_PERCENT) * GPU_POWER_LIMIT_SCALE);
    }

    return Math.floor(powerLimit * GPU_POWER_LIMIT_SCALE);
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
        filter(([gpuAutomationsEnabled]) => gpuAutomationsEnabled),
        // Check profile to be enabled
        map(
          ([, sleepModeEnabled]) =>
            [
              sleepModeEnabled
                ? this.currentMSIAfterburnerConfig.onSleepEnableProfile
                : this.currentMSIAfterburnerConfig.onSleepDisableProfile,
              sleepModeEnabled ? 'SLEEP_MODE_ENABLED' : 'SLEEP_MODE_DISABLED',
            ] as [number, 'SLEEP_MODE_ENABLED' | 'SLEEP_MODE_DISABLED']
        ),
        // Stop if no profile is to be enabled
        filter(([profile]) => profile > 0)
      )
      .subscribe(([profile, reason]) => this.setMSIAfterburnerProfile(profile, reason));
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
        map(([, curr]) => curr.msiAfterburnerPath),
        // Only while the sidecar is running
        switchMap((msiAfterburnerPath) =>
          this.sidecar.sidecarStarted.pipe(
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
        this.setMSIAfterburnerPath(msiAfterburnerPath as string, false);
      });
  }

  async setMSIAfterburnerProfile(
    index: number,
    reason: 'SLEEP_MODE_ENABLED' | 'SLEEP_MODE_DISABLED'
  ) {
    if (index < 1 || index > 5) {
      await error(`[GpuAutomations] Attempted to set invalid MSI Afterburner profile (${index})`);
      return;
    }
    const path = this.currentMSIAfterburnerConfig.msiAfterburnerPath;
    const generation = this.msiValidationGeneration;
    if (this._msiAfterburnerStatus.value !== 'SUCCESS' || this.validatedMSIPath !== path) {
      await warn(
        `[GpuAutomations] Could not set MSI Afterburner profile as no valid installation is currently configured`
      );
      return;
    }
    try {
      await invoke<boolean>('msi_afterburner_set_profile', {
        executablePath: path,
        profile: index,
      });
      this.eventLog.logEvent({
        type: 'msiAfterburnerProfileSet',
        profile: index,
        reason,
      } as EventLogMsiAfterburnerProfileSet);
    } catch (e) {
      if (
        generation !== this.msiValidationGeneration ||
        path !== this.currentMSIAfterburnerConfig.msiAfterburnerPath
      )
        return;
      if (typeof e === 'string') {
        this.handleMSIAfterburnerError(e);
      } else {
        error('[GpuAutomations] Failed to set MSI Afterburner profile: ' + e);
        this._msiAfterburnerStatus.next('UNKNOWN_ERROR');
      }
      return;
    }
  }

  async setMSIAfterburnerPath(path: string, save = true) {
    const generation = ++this.msiValidationGeneration;
    this.validatedMSIPath = undefined;
    this._msiAfterburnerStatus.next('CHECKING');
    if (save)
      await this.automationConfig.updateAutomationConfig<MSIAfterburnerAutomationConfig>(
        'MSI_AFTERBURNER',
        { msiAfterburnerPath: path }
      );
    if (generation !== this.msiValidationGeneration) return;
    if (!path.endsWith('MSIAfterburner.exe')) {
      this._msiAfterburnerStatus.next('NOT_FOUND');
      return;
    }
    try {
      await invoke<boolean>('msi_afterburner_set_profile', {
        executablePath: path,
        profile: 0, // Profile 0 for testing without actually setting a profile
      });
    } catch (e) {
      if (generation !== this.msiValidationGeneration) return;
      if (typeof e === 'string') {
        this.handleMSIAfterburnerError(e);
      } else {
        error('[GpuAutomations] Failed to set MSI Afterburner path: ' + e);
        this._msiAfterburnerStatus.next('UNKNOWN_ERROR');
      }
      return;
    }
    if (generation !== this.msiValidationGeneration) return;
    this.validatedMSIPath = path;
    this._msiAfterburnerStatus.next('SUCCESS');
  }

  async handleMSIAfterburnerError(e: string) {
    switch (e) {
      case 'ExeNotFound':
        this._msiAfterburnerStatus.next('NOT_FOUND');
        break;
      case 'ExeCannotExecute':
      case 'ExeUnverifiable':
        this._msiAfterburnerStatus.next('INVALID_EXECUTABLE');
        break;
      case 'ExeNotSigned':
      case 'ExeSignatureDisallowedNonEmbedded':
      case 'ExeSignatureDisallowedNoIssuer':
      case 'ExeSignatureDisallowedNoSubject':
      case 'ExeSignatureDisallowedNoMatch':
        this._msiAfterburnerStatus.next('INVALID_SIGNATURE');
        break;
      // Should never happen
      case 'InvalidProfileIndex':
      case 'UnknownError':
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
