import { Injectable } from '@angular/core';
import { SleepService } from './sleep.service';
import { AutomationConfigService } from './automation-config.service';
import {
  asyncScheduler,
  BehaviorSubject,
  combineLatest,
  delay,
  distinctUntilChanged,
  filter,
  firstValueFrom,
  from,
  ignoreElements,
  interval,
  map,
  merge,
  of,
  pairwise,
  Subject,
  switchMap,
  take,
  takeUntil,
  tap,
  throttleTime,
} from 'rxjs';
import {
  AUTOMATION_CONFIGS_DEFAULT,
  PowerDownWindowsMode,
  ShutdownAutomationsConfig,
} from '../models/automations';
import { isEqual } from 'lodash';
import { AppSettingsService } from './app-settings.service';
import { OpenVRService } from './openvr.service';
import { LighthouseConsoleService } from './lighthouse-console.service';
import { LighthouseService } from './lighthouse.service';
import { invoke } from '@tauri-apps/api/core';
import { warn } from '@tauri-apps/plugin-log';
import {
  EventLogShutdownSequenceCancelled,
  EventLogShutdownSequenceStarted,
  EventLogShutdownSequenceStartedReason,
  EventLogShutdownSequenceStepFailed,
  EventLogFailure,
} from '../models/event-log-entry';
import { EventLogService } from './event-log.service';
import { listen } from '@tauri-apps/api/event';
import { TranslocoService } from '@jsverse/transloco';
import { VRChatService } from './vrchat-api/vrchat.service';
import { DeviceManagerService } from './device-manager.service';
import { DMKnownDevice } from '../models/device-manager';

export type ShutdownSequenceStage = (typeof ShutdownSequenceStageOrder)[number];
export const ShutdownSequenceStageOrder = [
  'IDLE',
  'TURNING_OFF_DEVICES',
  'QUITTING_STEAMVR',
  'POWERING_DOWN',
];

@Injectable({
  providedIn: 'root',
})
export class ShutdownAutomationsService {
  private config: ShutdownAutomationsConfig = structuredClone(
    AUTOMATION_CONFIGS_DEFAULT.SHUTDOWN_AUTOMATIONS
  );
  private sleepMode = false;
  private sleepModeLastSet = 0;
  private triggeredThisSleep = false;
  private aloneSince = 0;
  private isAlone = false;
  private wasNotAlone = false;
  private _stage = new BehaviorSubject<ShutdownSequenceStage>('IDLE');
  public stage = this._stage.asObservable();
  private cancelFlag = false;
  /** Set for a whole run, including the device lookup before the first stage starts. */
  private running = false;
  private cancelEvent = new Subject<void>();
  public readonly sequenceCancelled = this.cancelEvent.asObservable();
  private turnOffKnownDevices: DMKnownDevice[] = [];

  constructor(
    private sleepService: SleepService,
    private automationConfigService: AutomationConfigService,
    private appSettings: AppSettingsService,
    private openvr: OpenVRService,
    private lighthouseConsole: LighthouseConsoleService,
    private lighthouse: LighthouseService,
    private eventLog: EventLogService,
    private translate: TranslocoService,
    private vrchat: VRChatService,
    private deviceManager: DeviceManagerService
  ) {}

  async init() {
    // Update with config changes
    this.automationConfigService.configs
      .pipe(
        map((configs) => configs.SHUTDOWN_AUTOMATIONS),
        tap((config) => (this.config = config))
      )
      .subscribe();
    this.automationConfigService.configs
      .pipe(
        map((configs) => configs.SHUTDOWN_AUTOMATIONS.turnOffDevices),
        switchMap((selection) => this.deviceManager.getDevicesForSelectionStream(selection))
      )
      .subscribe((devices) => (this.turnOffKnownDevices = devices.knownDevices));
    this.automationConfigService.configs
      .pipe(
        map((configs) => configs.SHUTDOWN_AUTOMATIONS),
        // Reset the 'last set' in case any of the trigger parameters change, so the user doesn't get any unwanted surprises
        pairwise(),
        filter(([oldConfig, newConfig]) => {
          const keys: Array<keyof ShutdownAutomationsConfig> = [
            'triggerOnSleep',
            'triggerOnSleepDuration',
            'triggerOnSleepActivationWindow',
            'triggerOnSleepActivationWindowStart',
            'triggerOnSleepActivationWindowEnd',
          ];
          return keys.some((key) => !isEqual(oldConfig[key], newConfig[key]));
        }),
        tap(() => (this.sleepModeLastSet = Date.now()))
      )
      .subscribe();
    this.automationConfigService.configs
      .pipe(
        map((configs) => configs.SHUTDOWN_AUTOMATIONS),
        // Reset the 'alone since' in case any of the trigger parameters change, so the user doesn't get any unwanted surprises
        pairwise(),
        filter(([oldConfig, newConfig]) => {
          const keys: Array<keyof ShutdownAutomationsConfig> = [
            'triggerWhenAlone',
            'triggerWhenAloneDuration',
            'triggerWhenAloneOnlyWhenSleepModeActive',
            'triggerWhenAloneActivationWindow',
            'triggerWhenAloneActivationWindowStart',
            'triggerWhenAloneActivationWindowEnd',
          ];
          return keys.some((key) => !isEqual(oldConfig[key], newConfig[key]));
        }),
        filter(() => this.isAlone),
        tap(() => (this.aloneSince = Date.now()))
      )
      .subscribe();
    // Track sleep mode being set
    this.sleepService.mode.pipe(distinctUntilChanged()).subscribe((mode) => {
      this.sleepMode = mode;
      if (!this.sleepMode) this.triggeredThisSleep = false;
      this.sleepModeLastSet = Date.now();
    });
    // Track being alone
    combineLatest([this.vrchat.world, this.vrchat.vrchatProcessActive])
      .pipe(
        tap(([world, active]) => {
          if (world.players.length > 1) this.wasNotAlone = true;
          if (!active) this.wasNotAlone = false;
        }),
        map(([world, active]) => (active && world.loaded ? world.players.length : 0)),
        distinctUntilChanged(),
        map((playerCount) => playerCount === 1 && this.wasNotAlone)
      )
      .subscribe((alone) => {
        this.isAlone = alone;
        if (alone) this.aloneSince = Date.now();
      });
    // Handle automated triggers
    await this.handleTriggerOnSleep();
    await this.handleTriggerWhenAlone();
    // Trigger through overlay
    await listen('startShutdownSequence', () => {
      this.runSequence('MANUAL');
    });
  }

  getApplicableStages(): ShutdownSequenceStage[] {
    const stages: ShutdownSequenceStage[] = [];
    if (this.turnOffKnownDevices.length) stages.push('TURNING_OFF_DEVICES');
    if (this.config.quitSteamVR) stages.push('QUITTING_STEAMVR');
    if (this.config.powerDownWindows) stages.push('POWERING_DOWN');
    return stages;
  }

  async cancelSequence(reason: 'MANUAL') {
    if (!this.running || this.cancelFlag) return;
    this.cancelFlag = true;
    this.cancelEvent.next();
    this.eventLog.logEvent({
      type: 'shutdownSequenceCancelled',
      reason,
    } as EventLogShutdownSequenceCancelled);
    // Cancel any pending shutdown
    await invoke('run_command', {
      command: 'shutdown',
      args: ['/a'],
    });
  }

  async runSequence(reason: EventLogShutdownSequenceStartedReason) {
    const stages = this.getApplicableStages();
    if (this.running || !stages.length) return;
    this.running = true;
    this.eventLog.logEvent({
      type: 'shutdownSequenceStarted',
      reason,
      stages,
    } as EventLogShutdownSequenceStarted);
    try {
      if (!(await this.turnOffDevices())) return;
      if (!(await this.quitSteamVR())) return;
      if (!(await this.powerDownWindows())) return;
    } finally {
      this._stage.next('IDLE');
      this.cancelFlag = false;
      this.running = false;
    }
  }

  private async handleTriggerOnSleep() {
    interval(1000)
      .pipe(
        // Only trigger if this trigger is enabled
        filter(() => this.config.triggersEnabled),
        filter(() => this.config.triggerOnSleep),
        // Only trigger if the shutdown sequence isn't running
        filter(() => this._stage.value === 'IDLE'),
        // Only trigger if the sleep mode is active
        filter(() => this.sleepMode),
        // Only trigger if we haven't already triggered this sleep (resets once sleep mode disables)
        filter(() => !this.triggeredThisSleep),
        // Only trigger if the sleep mode has been active for long enough
        filter(() => Date.now() - this.sleepModeLastSet >= this.config.triggerOnSleepDuration),
        // Only trigger if we're in the activation window, if it's configured
        filter(
          () =>
            !this.config.triggerOnSleepActivationWindow ||
            this.isInActivationWindow(
              this.config.triggerOnSleepActivationWindowStart,
              this.config.triggerOnSleepActivationWindowEnd
            )
        )
      )
      .subscribe(() => {
        this.triggeredThisSleep = true;
        this.runSequence('SLEEP_TRIGGER');
      });
  }

  private async handleTriggerWhenAlone() {
    interval(1000)
      .pipe(
        filter(() => this._stage.value === 'IDLE'),
        filter(() => this.config.triggersEnabled),
        filter(() => this.config.triggerWhenAlone),
        filter(() => this.isAlone),
        filter(() => Date.now() - this.aloneSince >= this.config.triggerWhenAloneDuration),
        filter(
          () =>
            !this.config.triggerWhenAloneActivationWindow ||
            this.isInActivationWindow(
              this.config.triggerWhenAloneActivationWindowStart,
              this.config.triggerWhenAloneActivationWindowEnd
            )
        ),
        filter(() => !this.config.triggerWhenAloneOnlyWhenSleepModeActive || this.sleepMode),
        // Only trigger once every 5 minutes at most
        throttleTime(300000, asyncScheduler, { leading: true, trailing: false })
      )
      .subscribe(() => this.runSequence('VRC_ALONE_TRIGGER'));
  }

  private isInActivationWindow(
    start: [number, number],
    end: [number, number],
    now?: [number, number]
  ): boolean {
    if (!now) now = [new Date().getHours(), new Date().getMinutes()];
    const startMinutes = start[0] * 60 + start[1];
    const endMinutes = end[0] * 60 + end[1];
    const nowMinutes = now[0] * 60 + now[1];

    if (startMinutes < endMinutes) {
      return nowMinutes >= startMinutes && nowMinutes <= endMinutes;
    }
    return nowMinutes <= endMinutes || nowMinutes >= startMinutes;
  }

  private async quitSteamVR() {
    if (this.cancelFlag) {
      this.cancelFlag = false;
      this._stage.next('IDLE');
      return false;
    }
    if (!this.config.quitSteamVR) return true;
    this._stage.next('QUITTING_STEAMVR');
    // Quit steam
    await invoke('quit_steamvr', { kill: false });
    // Wait up to 10 seconds for SteamVR to quit, killing it after 5, even after a cancel
    const quit = this.openvr.status.pipe(
      filter((s) => s === 'INACTIVE'),
      take(1),
      map(() => true)
    );
    // the core reports INACTIVE only after vrserver exits, which can lag behind the kill
    const forceQuit = of(null).pipe(
      delay(5000),
      takeUntil(quit),
      switchMap(() => invoke('quit_steamvr', { kill: true })),
      ignoreElements()
    );
    const steamVrQuit = await firstValueFrom(merge(quit, forceQuit, of(false).pipe(delay(10000))));
    if (!this.cancelFlag && !steamVrQuit) this.logStepFailed('QUITTING_STEAMVR', 'UNKNOWN');
    await firstValueFrom(merge(of(null).pipe(delay(1000)), this.cancelEvent));
    return true;
  }

  private async turnOffDevices(): Promise<boolean> {
    // the selection stream skips power state changes, so resolve the current states here
    const selected = await this.deviceManager.getDevicesForSelection(this.config.turnOffDevices);
    if (this.cancelFlag) {
      this.cancelFlag = false;
      this._stage.next('IDLE');
      return false;
    }
    if (
      !selected.ovrDevices.length &&
      (!selected.lighthouseDevices.length || !this.appSettings.settingsSync.lighthousePowerControl)
    )
      return true;
    this._stage.next('TURNING_OFF_DEVICES');

    let ovrDevicesFailed = false;
    let lighthousesFailed = false;
    if (selected.ovrDevices.length) {
      // Turn off controllers and trackers
      const devices = structuredClone(selected.ovrDevices).filter((d) => d.canPowerOff);
      this.lighthouseConsole.turnOffDevices(devices);
      // Wait for controllers and trackers to turn off with a timeout of 10 seconds
      await firstValueFrom(
        merge(
          interval(250).pipe(
            switchMap(() =>
              this.openvr.devices.pipe(
                map((newDevices) =>
                  newDevices.filter(
                    (device) =>
                      device.serialNumber &&
                      devices.some((requested) => requested.serialNumber === device.serialNumber)
                  )
                )
              )
            ),
            filter((devices) => devices.every((d) => !d.isTurningOff && !d.isConnected))
          ),
          of(null).pipe(delay(10000)),
          this.cancelEvent
        )
      );
      ovrDevicesFailed = (await firstValueFrom(this.openvr.devices)).some(
        (device) =>
          device.isConnected && devices.some((d) => d.serialNumber === device.serialNumber)
      );
    }

    if (selected.lighthouseDevices.length && this.appSettings.settingsSync.lighthousePowerControl) {
      const offPowerState = this.appSettings.settingsSync.lighthousePowerOffState;
      const devices = structuredClone(selected.lighthouseDevices).filter(
        (d) =>
          (d.powerState === 'on' || d.powerState === 'booting') &&
          !this.lighthouse.deviceNeedsIdentifier(d)
      );
      // setPowerState resolves within about 11 seconds, and maps a V1's standby to sleep
      const results = Promise.all(
        devices.map((device) => this.lighthouse.setPowerState(device, offPowerState))
      );
      const reached = await firstValueFrom(
        merge(from(results), this.cancelEvent.pipe(map(() => null)))
      );
      lighthousesFailed = !!reached?.some((deviceReached) => !deviceReached);
    }

    // report devices still on after the wait, unless the user cancelled
    if (!this.cancelFlag && (ovrDevicesFailed || lighthousesFailed)) {
      let failure: EventLogFailure = 'UNKNOWN';
      if (!ovrDevicesFailed) failure = 'BASE_STATION_NO_RESPONSE';
      else if (!lighthousesFailed) failure = this.lighthouseConsole.powerOffFailure;
      this.logStepFailed('TURNING_OFF_DEVICES', failure);
    }

    await firstValueFrom(merge(of(null).pipe(delay(1000)), this.cancelEvent));
    return true;
  }

  private logStepFailed(
    step: EventLogShutdownSequenceStepFailed['step'],
    failure: EventLogFailure
  ) {
    this.eventLog.logEvent({ type: 'shutdownSequenceStepFailed', step, failure });
  }

  private async powerDownWindows(): Promise<boolean> {
    if (this.cancelFlag) {
      this.cancelFlag = false;
      this._stage.next('IDLE');
      return false;
    }
    if (!this.config.powerDownWindows) return true;
    this._stage.next('POWERING_DOWN');
    // Power down windows
    switch (this.config.powerDownWindowsMode) {
      case 'SHUTDOWN':
      case 'REBOOT': {
        const mode = this.config.powerDownWindowsMode;
        const message = this.translate.translate(
          mode === 'SHUTDOWN'
            ? 'shutdown-automations.sequence.powerDownWindows.shutdownMessage'
            : 'shutdown-automations.sequence.powerDownWindows.rebootMessage'
        );
        const command = mode === 'SHUTDOWN' ? 'windows_shutdown' : 'windows_reboot';
        const args = { message, timeout: 20, forceCloseApps: true };
        if (await this.runPowerCommand(mode, command, args)) {
          await firstValueFrom(merge(of(null).pipe(delay(30000)), this.cancelEvent));
        }
        break;
      }
      case 'SLEEP':
        return this.dispatchDelayedPowerCommand('SLEEP', 'windows_sleep');
      case 'HIBERNATE':
        return this.dispatchDelayedPowerCommand('HIBERNATE', 'windows_hibernate');
      case 'LOGOUT':
        return this.dispatchDelayedPowerCommand('LOGOUT', 'windows_logout');
    }
    return true;
  }

  private async dispatchDelayedPowerCommand(
    mode: PowerDownWindowsMode,
    command: string
  ): Promise<boolean> {
    await firstValueFrom(merge(of(null).pipe(delay(500)), this.cancelEvent));
    if (this.cancelFlag) return false;
    // sleep and hibernate resolve only after the PC wakes up, so the sequence does not wait
    void this.runPowerCommand(mode, command);
    return true;
  }

  /** Resolves false, and logs a failed step, when Windows refused the command. */
  private runPowerCommand(
    mode: PowerDownWindowsMode,
    command: string,
    args?: Record<string, unknown>
  ): Promise<boolean> {
    return invoke(command, args).then(
      () => true,
      (e) => {
        warn(`[ShutdownAutomations] Windows refused ${command}: ${e}`);
        this.logStepFailed(mode, 'UNKNOWN');
        return false;
      }
    );
  }
}
