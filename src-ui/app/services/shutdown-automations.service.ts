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
  interval,
  map,
  merge,
  of,
  pairwise,
  Subject,
  switchMap,
  take,
  tap,
  throttleTime,
} from 'rxjs';
import { AUTOMATION_CONFIGS_DEFAULT, ShutdownAutomationsConfig } from '../models/automations';
import { isEqual } from 'lodash';
import { AppSettingsService } from './app-settings.service';
import { OpenVRService } from './openvr.service';
import { LighthouseConsoleService } from './lighthouse-console.service';
import { LighthouseService } from './lighthouse.service';
import { invoke } from '@tauri-apps/api/core';
import {
  EventLogShutdownSequenceCancelled,
  EventLogShutdownSequenceStarted,
  EventLogShutdownSequenceStartedReason,
} from '../models/event-log-entry';
import { EventLogService } from './event-log.service';
import { listen } from '@tauri-apps/api/event';
import { TranslateService } from '@ngx-translate/core';
import { VRChatService } from './vrchat.service';

export type ShutdownSequenceStage = (typeof ShutdownSequenceStageOrder)[number];
export const ShutdownSequenceStageOrder = [
  'IDLE',
  'TURNING_OFF_CONTROLLERS',
  'TURNING_OFF_TRACKERS',
  'TURNING_OFF_BASESTATIONS',
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
  private cancelEvent = new Subject<void>();

  constructor(
    private sleepService: SleepService,
    private automationConfigService: AutomationConfigService,
    private appSettings: AppSettingsService,
    private openvr: OpenVRService,
    private lighthouseConsole: LighthouseConsoleService,
    private lighthouse: LighthouseService,
    private eventLog: EventLogService,
    private translate: TranslateService,
    private vrchat: VRChatService
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
          if (world.playerCount > 1) this.wasNotAlone = true;
          if (!active) this.wasNotAlone = false;
        }),
        map(([world, active]) => (active && world.loaded ? world.playerCount : 0)),
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

  getApplicableStages(config?: ShutdownAutomationsConfig): ShutdownSequenceStage[] {
    config ??= this.config;
    const stages: ShutdownSequenceStage[] = [];
    if (config.turnOffControllers) stages.push('TURNING_OFF_CONTROLLERS');
    if (config.turnOffTrackers) stages.push('TURNING_OFF_TRACKERS');
    if (config.turnOffBaseStations) stages.push('TURNING_OFF_BASESTATIONS');
    if (config.quitSteamVR) stages.push('QUITTING_STEAMVR');
    if (config.powerDownWindows) stages.push('POWERING_DOWN');
    return stages;
  }

  async cancelSequence(reason: 'MANUAL') {
    if (this._stage.value === 'IDLE' || this.cancelFlag) return;
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
    if (this._stage.value !== 'IDLE' || !stages.length) return;
    this.eventLog.logEvent({
      type: 'shutdownSequenceStarted',
      reason,
      stages,
    } as EventLogShutdownSequenceStarted);
    if (!(await this.turnOffControllers())) return;
    if (!(await this.turnOffTrackers())) return;
    if (!(await this.turnOffBaseStations())) return;
    if (!(await this.quitSteamVR())) return;
    if (!(await this.powerDownWindows())) return;
    this._stage.next('IDLE');
    this.cancelFlag = false;
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
    // Wait for steam to quit with a timeout of 10 seconds
    await firstValueFrom(
      merge(
        this.openvr.status.pipe(
          filter((s) => s === 'INACTIVE'),
          take(1)
        ),
        of(null).pipe(
          delay(5000),
          switchMap(() => invoke('quit_steamvr', { kill: true }))
        ),
        of(null).pipe(delay(10000)),
        this.cancelEvent
      )
    );
    await firstValueFrom(merge(of(null).pipe(delay(1000)), this.cancelEvent));
    return true;
  }

  private async turnOffControllers(): Promise<boolean> {
    if (this.cancelFlag) {
      this.cancelFlag = false;
      this._stage.next('IDLE');
      return false;
    }
    if (!this.config.turnOffControllers) return true;
    this._stage.next('TURNING_OFF_CONTROLLERS');
    // Get devices to turn off
    const devices = await firstValueFrom(
      this.openvr.devices.pipe(
        map((devices) => devices.filter((d) => d.canPowerOff && d.class === 'Controller'))
      )
    );
    if (devices?.length) {
      // Turn off controllers
      this.lighthouseConsole.turnOffDevices(devices);
      // Wait for controllers to turn off with a timeout of 10 seconds
      await firstValueFrom(
        merge(
          interval(250).pipe(
            switchMap(() =>
              this.openvr.devices.pipe(
                map((newDevices) =>
                  newDevices.filter((d) => devices.some((d2) => d2.index === d.index))
                )
              )
            ),
            filter((devices) => devices.every((d) => !d.isTurningOff && !d.canPowerOff))
          ),
          of(null).pipe(delay(10000)),
          this.cancelEvent
        )
      );
    }
    await firstValueFrom(merge(of(null).pipe(delay(1000)), this.cancelEvent));
    return true;
  }

  private async turnOffTrackers(): Promise<boolean> {
    if (this.cancelFlag) {
      this.cancelFlag = false;
      this._stage.next('IDLE');
      return false;
    }
    if (!this.config.turnOffTrackers) return true;
    this._stage.next('TURNING_OFF_TRACKERS');
    // Get devices to turn off
    const devices = await firstValueFrom(
      this.openvr.devices.pipe(
        map((devices) => devices.filter((d) => d.canPowerOff && d.class === 'GenericTracker'))
      )
    );
    if (devices?.length) {
      // Turn off trackers
      this.lighthouseConsole.turnOffDevices(devices);
      // Wait for trackers to turn off with a timeout of 10 seconds
      await firstValueFrom(
        merge(
          interval(250).pipe(
            switchMap(() =>
              this.openvr.devices.pipe(
                map((newDevices) =>
                  newDevices.filter((d) => devices.some((d2) => d2.index === d.index))
                )
              )
            ),
            filter((devices) => devices.every((d) => !d.isTurningOff && !d.canPowerOff))
          ),
          of(null).pipe(delay(10000)),
          this.cancelEvent
        )
      );
    }
    await firstValueFrom(merge(of(null).pipe(delay(1000)), this.cancelEvent));
    return true;
  }

  private async turnOffBaseStations(): Promise<boolean> {
    if (this.cancelFlag) {
      this.cancelFlag = false;
      this._stage.next('IDLE');
      return false;
    }
    const lighthousePowerControl = await firstValueFrom(
      this.appSettings.settings.pipe(map((settings) => settings.lighthousePowerControl))
    );
    if (!this.config.turnOffBaseStations || !lighthousePowerControl) return true;
    this._stage.next('TURNING_OFF_BASESTATIONS');
    // Get base stations to turn off
    const devices = await firstValueFrom(
      this.lighthouse.devices.pipe(
        map((devices) => devices.filter((d) => ['on', 'booting'].includes(d.powerState)))
      )
    );
    // Turn them off
    if (devices?.length) {
      const offPowerState = await firstValueFrom(
        this.appSettings.settings.pipe(map((settings) => settings.lighthousePowerOffState))
      );
      devices.forEach((device) => this.lighthouse.setPowerState(device, offPowerState));
      // Wait for all base stations to turn off with a timeout of 10 seconds
      await firstValueFrom(
        merge(
          interval(250).pipe(
            switchMap(() =>
              this.lighthouse.devices.pipe(
                map((newDevices) => newDevices.filter((d) => devices.some((d2) => d2.id === d.id)))
              )
            ),
            filter((devices) => devices.every((d) => d.powerState === offPowerState))
          ),
          of(null).pipe(delay(10000)),
          this.cancelEvent
        )
      );
    }
    await firstValueFrom(merge(of(null).pipe(delay(1000)), this.cancelEvent));
    return true;
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
        await invoke('windows_shutdown', {
          message: this.translate.instant(
            'shutdown-automations.sequence.powerDownWindows.shutdownMessage'
          ),
          timeout: 20,
          forceCloseApps: true,
        });
        await firstValueFrom(merge(of(null).pipe(delay(30000)), this.cancelEvent));
        break;
      case 'REBOOT':
        await invoke('windows_reboot', {
          message: this.translate.instant(
            'shutdown-automations.sequence.powerDownWindows.rebootMessage'
          ),
          timeout: 20,
          forceCloseApps: true,
        });
        await firstValueFrom(merge(of(null).pipe(delay(30000)), this.cancelEvent));
        break;
      case 'SLEEP':
        setTimeout(() => invoke('windows_sleep'), 500);
        break;
      case 'HIBERNATE':
        setTimeout(() => invoke('windows_hibernate'), 500);
        break;
      case 'LOGOUT':
        setTimeout(() => invoke('windows_logout'), 500);
        break;
    }
    return true;
  }
}
