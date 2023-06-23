import { Injectable } from '@angular/core';
import { SleepService } from './sleep.service';
import { AutomationConfigService } from './automation-config.service';
import {
  asyncScheduler,
  BehaviorSubject,
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
import { cloneDeep, isEqual } from 'lodash';
import { AppSettingsService } from './app-settings.service';
import { OpenVRService } from './openvr.service';
import { LighthouseConsoleService } from './lighthouse-console.service';
import { LighthouseService } from './lighthouse.service';
import { invoke } from '@tauri-apps/api';
import {
  EventLogShutdownSequenceCancelled,
  EventLogShutdownSequenceStarted,
} from '../models/event-log-entry';
import { EventLogService } from './event-log.service';

export type ShutdownSequenceStage = (typeof ShutdownSequenceStageOrder)[number];
export const ShutdownSequenceStageOrder = [
  'IDLE',
  'TURNING_OFF_CONTROLLERS',
  'TURNING_OFF_TRACKERS',
  'TURNING_OFF_BASESTATIONS',
  'QUITTING_STEAMVR',
  'SHUTTING_DOWN',
];

@Injectable({
  providedIn: 'root',
})
export class ShutdownAutomationsService {
  private config: ShutdownAutomationsConfig = cloneDeep(
    AUTOMATION_CONFIGS_DEFAULT.SHUTDOWN_AUTOMATIONS
  );
  private sleepMode = false;
  private sleepModeLastSet = 0;
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
    private eventLog: EventLogService
  ) {}

  async init() {
    // Update with config changes
    this.automationConfigService.configs
      .pipe(
        map((configs) => configs.SHUTDOWN_AUTOMATIONS),
        tap((config) => (this.config = config)),
        // Reset the 'last set' in case any of the trigger parameters change, so the user doesn't get any unwanted surprises
        pairwise(),
        filter(
          ([oldConfig, newConfig]) =>
            oldConfig.triggerOnSleep !== newConfig.triggerOnSleep ||
            oldConfig.activationWindow !== newConfig.activationWindow ||
            !isEqual(oldConfig.activationWindowStart, newConfig.activationWindowStart) ||
            !isEqual(oldConfig.activationWindowEnd, newConfig.activationWindowEnd) ||
            oldConfig.sleepDuration !== newConfig.sleepDuration
        ),
        tap(() => (this.sleepModeLastSet = Date.now()))
      )
      .subscribe();
    // Track sleep mode being set
    this.sleepService.mode.pipe(distinctUntilChanged()).subscribe((mode) => {
      this.sleepMode = mode;
      this.sleepModeLastSet = Date.now();
    });
    // Trigger when asleep long enough
    this.handleTriggerOnSleep();
  }

  getApplicableStages(): ShutdownSequenceStage[] {
    const stages: ShutdownSequenceStage[] = [];
    if (this.config.turnOffControllers) stages.push('TURNING_OFF_CONTROLLERS');
    if (this.config.turnOffTrackers) stages.push('TURNING_OFF_TRACKERS');
    if (this.config.turnOffBaseStations) stages.push('TURNING_OFF_BASESTATIONS');
    if (this.config.quitSteamVR) stages.push('QUITTING_STEAMVR');
    if (this.config.shutdownWindows) stages.push('SHUTTING_DOWN');
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

  async runSequence(reason: 'MANUAL' | 'SLEEP_TRIGGER') {
    if (this._stage.value !== 'IDLE') return;
    this.eventLog.logEvent({
      type: 'shutdownSequenceStarted',
      reason,
      stages: this.getApplicableStages(),
    } as EventLogShutdownSequenceStarted);
    if (!(await this.turnOffControllers())) return;
    if (!(await this.turnOffTrackers())) return;
    if (!(await this.turnOffBaseStations())) return;
    if (!(await this.quitSteamVR())) return;
    if (!(await this.shutdownWindows())) return;
    this._stage.next('IDLE');
    this.cancelFlag = false;
  }

  private async handleTriggerOnSleep() {
    interval(1000)
      .pipe(
        filter(() => this._stage.value === 'IDLE'),
        filter(() => this.config.triggerOnSleep),
        filter(() => this.sleepMode),
        filter(() => Date.now() - this.sleepModeLastSet >= this.config.sleepDuration),
        filter(
          () =>
            !this.config.activationWindow ||
            this.isInActivationWindow(
              this.config.activationWindowStart,
              this.config.activationWindowEnd
            )
        ),
        // Only trigger once every 5 minutes at most
        throttleTime(300000, asyncScheduler, { leading: true, trailing: false })
      )
      .subscribe(() => this.runSequence('SLEEP_TRIGGER'));
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

  private async shutdownWindows(): Promise<boolean> {
    if (this.cancelFlag) {
      this.cancelFlag = false;
      this._stage.next('IDLE');
      return false;
    }
    if (!this.config.shutdownWindows) return true;
    this._stage.next('SHUTTING_DOWN');
    // Shutdown windows
    await invoke('run_command', {
      command: 'shutdown',
      args: ['/s', '/t', '10'],
    });
    // Wait for 30 seconds, then stop the sequence (if the pc hasn't already shut down)
    await firstValueFrom(merge(of(null).pipe(delay(30000)), this.cancelEvent));
    return true;
  }
}
