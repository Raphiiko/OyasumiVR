import { Injectable } from '@angular/core';
import {
  asyncScheduler,
  BehaviorSubject,
  combineLatest,
  debounceTime,
  distinctUntilChanged,
  filter,
  firstValueFrom,
  interval,
  map,
  skip,
  startWith,
  switchMap,
  throttleTime,
} from 'rxjs';
import {
  AUTOMATION_CONFIGS_DEFAULT,
  BigscreenBeyondFanControlAutomationsConfig,
} from '../../models/automations';

import { AutomationConfigService } from '../automation-config.service';
import { SleepService } from '../sleep.service';
import { SleepPreparationService } from '../sleep-preparation.service';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api';
import { clamp } from '../../utils/number-utils';
import { APP_SETTINGS_DEFAULT, AppSettings } from '../../models/settings';
import { AppSettingsService } from '../app-settings.service';
import { HardwareBrightnessControlService } from '../brightness-control/hardware-brightness-control.service';
import { warn } from 'tauri-plugin-log-api';
import { EventLogService } from '../event-log.service';
import { EventLogBSBFanSpeedChanged } from '../../models/event-log-entry';

const MIN_SAFE_FAN_SPEED = 40;

@Injectable({
  providedIn: 'root',
})
export class BigscreenBeyondFanAutomationService {
  private _connected = new BehaviorSubject(false);
  public bsbConnected = this._connected.asObservable();
  private config: BigscreenBeyondFanControlAutomationsConfig = structuredClone(
    AUTOMATION_CONFIGS_DEFAULT.BIGSCREEN_BEYOND_FAN_CONTROL
  );
  private appSettings: AppSettings = structuredClone(APP_SETTINGS_DEFAULT);
  private _fanSpeed = new BehaviorSubject<number>(50);
  public fanSpeed = this._fanSpeed.asObservable();
  private _fanSafetyActive = new BehaviorSubject(false);
  public fanSafetyActive = this._fanSafetyActive.asObservable();
  private fanSpeedRestoreValue = 50;

  constructor(
    private automationConfigService: AutomationConfigService,
    private sleepService: SleepService,
    private sleepPreparation: SleepPreparationService,
    private appSettingsService: AppSettingsService,
    private hardwareBrightness: HardwareBrightnessControlService,
    private eventLog: EventLogService
  ) {}

  async init() {
    // Listen for config changes
    this.appSettingsService.settings.subscribe((settings) => {
      this.appSettings = settings;
    });
    this.automationConfigService.configs
      .pipe(map((c) => c.BIGSCREEN_BEYOND_FAN_CONTROL))
      .subscribe((config) => (this.config = config));
    // Listen for the connection state of the Bigscreen Beyond
    listen<boolean>('BIGSCREEN_BEYOND_CONNECTED', (event) => {
      this._connected.next(event.payload);
    });
    interval(10000)
      .pipe(
        startWith(0),
        switchMap(async () => {
          const connected = await invoke<boolean>('bigscreen_beyond_is_connected');
          this._connected.next(connected);
        })
      )
      .subscribe();
    // Handle fan speed when the HMD is being connected
    this._connected
      .pipe(distinctUntilChanged(), debounceTime(500), filter(Boolean))
      .subscribe(() => this.onHmdConnect());
    // Setup the automations
    this.handleFanSafety();
    this.sleepService.mode
      .pipe(distinctUntilChanged(), skip(1))
      .subscribe((sleepMode) => this.onSleepModeChange(sleepMode));
    this.sleepPreparation.onSleepPreparation.subscribe(() => this.onSleepPreparation());
  }

  private async onHmdConnect() {
    const sleepMode = await firstValueFrom(this.sleepService.mode);
    let setFanValue;
    if (this.config.onSleepEnable && sleepMode) {
      setFanValue = this.config.onSleepEnableFanSpeed;
    } else if (this.config.onSleepDisable && !sleepMode) {
      setFanValue = this.config.onSleepDisableFanSpeed;
    } else {
      setFanValue = await this.getBeyondDriverSavedFanSpeed();
    }
    if (setFanValue !== null) await this.setFanSpeed(setFanValue, true);
  }

  private async onSleepModeChange(sleepMode: boolean) {
    if (!this._connected.value) return;
    if (sleepMode && this.config.onSleepEnable) {
      const speedSet = await this.setFanSpeed(this.config.onSleepEnableFanSpeed);
      if (speedSet !== null) {
        this.eventLog.logEvent({
          type: 'bsbFanSpeedChanged',
          reason: 'SLEEP_MODE_ENABLED',
          speed: this.config.onSleepEnableFanSpeed,
          effectiveSpeed: speedSet,
        } as EventLogBSBFanSpeedChanged);
      }
    } else if (!sleepMode && this.config.onSleepDisable) {
      const speedSet = await this.setFanSpeed(this.config.onSleepDisableFanSpeed);
      if (speedSet !== null) {
        this.eventLog.logEvent({
          type: 'bsbFanSpeedChanged',
          reason: 'SLEEP_MODE_DISABLED',
          speed: this.config.onSleepDisableFanSpeed,
          effectiveSpeed: speedSet,
        } as EventLogBSBFanSpeedChanged);
      }
    }
  }

  private async onSleepPreparation() {
    if (!this._connected.value) return;
    if (this.config.onSleepPreparation) {
      const speedSet = await this.setFanSpeed(this.config.onSleepPreparationFanSpeed);
      if (speedSet !== null) {
        this.eventLog.logEvent({
          type: 'bsbFanSpeedChanged',
          reason: 'SLEEP_PREPARATION',
          speed: this.config.onSleepPreparationFanSpeed,
          effectiveSpeed: speedSet,
        } as EventLogBSBFanSpeedChanged);
      }
    }
  }

  private async handleFanSafety() {
    combineLatest([
      this.appSettingsService.settings.pipe(
        map((s) => s.bigscreenBeyondBrightnessFanSafety),
        distinctUntilChanged(),
        throttleTime(100, asyncScheduler, { leading: true, trailing: true })
      ),
      this.hardwareBrightness.brightnessStream.pipe(distinctUntilChanged()),
    ]).subscribe(([fanSafety, brightness]) => {
      // Force to 100% fan speed above 100% brightness
      if (fanSafety && brightness > 100 && !this._fanSafetyActive.value) {
        this.setFanSpeed(100, false);
        this._fanSafetyActive.next(true);
      }
      // Restore fan speed when brightness is back to safe range
      if (this._fanSafetyActive.value && brightness <= 100) {
        this._fanSafetyActive.next(false);
        this.setFanSpeed(
          clamp(
            this.fanSpeedRestoreValue,
            this.config.allowUnsafeFanSpeed ? 0 : MIN_SAFE_FAN_SPEED,
            100
          )
        );
      }
    });
  }

  public async setFanSpeed(speed: number, saveAsRestore = true): Promise<number | null> {
    if (!this._connected.value) return null;
    // Keep fan speed in safe range
    speed = clamp(speed, this.config.allowUnsafeFanSpeed ? 0 : MIN_SAFE_FAN_SPEED, 100);
    if (saveAsRestore) {
      this.fanSpeedRestoreValue = speed;
    }
    // Force to 100% fan speed above 100% brightness
    if (
      this.appSettings.bigscreenBeyondBrightnessFanSafety &&
      this.hardwareBrightness.brightness > 100 &&
      speed < 100
    )
      speed = 100;
    // Set the fan speed
    this._fanSpeed.next(speed);
    await invoke('bigscreen_beyond_set_fan_speed', { speed });
    return speed;
  }

  private getBeyondDriverSavedFanSpeed(): Promise<number | null> {
    return invoke<string>('bigscreen_beyond_get_saved_preferences').then((result) => {
      if (!result) return null;
      let preferences: { fan_speed: number } | undefined;
      try {
        preferences = JSON.parse(result);
      } catch (e) {
        warn(
          '[BigscreenBeyondFanAutomationService] Failed to parse saved preferences from Bigscreen Beyond driver utility: ' +
            e
        );
        return null;
      }
      if (!preferences || !isFinite(preferences?.fan_speed)) return null;
      return preferences.fan_speed;
    });
  }
}
