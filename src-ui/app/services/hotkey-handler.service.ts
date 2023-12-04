import { Injectable } from '@angular/core';
import { HotkeyService } from './hotkey.service';
import { SleepPreparationService } from './sleep-preparation.service';
import { SleepService } from './sleep.service';
import { ShutdownAutomationsService } from './shutdown-automations.service';
import { filter, firstValueFrom, map, take } from 'rxjs';
import { warn } from 'tauri-plugin-log-api';
import { LighthouseConsoleService } from './lighthouse-console.service';
import { LighthouseService } from './lighthouse.service';
import { OpenVRService } from './openvr.service';
import { AppSettingsService } from './app-settings.service';
import {
  EventLogLighthouseSetPowerState,
  EventLogTurnedOffOpenVRDevices,
} from '../models/event-log-entry';
import { EventLogService } from './event-log.service';

@Injectable({
  providedIn: 'root',
})
export class HotkeyHandlerService {
  constructor(
    private hotkeyService: HotkeyService,
    private sleep: SleepService,
    private sleepPreparation: SleepPreparationService,
    private shutdownSequence: ShutdownAutomationsService,
    private lighthouseService: LighthouseService,
    private lighthouseConsoleService: LighthouseConsoleService,
    private openvr: OpenVRService,
    private appSettings: AppSettingsService,
    private eventLog: EventLogService
  ) {}

  public async init() {
    this.hotkeyService.hotkeyPressed.subscribe(async (hotkey) => {
      switch (hotkey) {
        case 'HOTKEY_TOGGLE_SLEEP_MODE':
          if (await firstValueFrom(this.sleep.mode)) {
            await this.sleep.disableSleepMode({ type: 'HOTKEY' });
          } else {
            await this.sleep.enableSleepMode({ type: 'HOTKEY' });
          }
          break;
        case 'HOTKEY_ENABLE_SLEEP_MODE':
          await this.sleep.enableSleepMode({ type: 'HOTKEY' });
          break;
        case 'HOTKEY_DISABLE_SLEEP_MODE':
          await this.sleep.disableSleepMode({ type: 'HOTKEY' });
          break;
        case 'HOTKEY_RUN_SLEEP_PREPARATION':
          await this.sleepPreparation.prepareForSleep();
          break;
        case 'HOTKEY_RUN_SHUTDOWN_SEQUENCE':
          await this.shutdownSequence.runSequence('HOTKEY');
          break;
        case 'HOTKEY_TURN_OFF_CONTROLLER_DEVICES':
          await this.turnOffControllerDevices();
          break;
        case 'HOTKEY_TURN_OFF_TRACKER_DEVICES':
          await this.turnOffTrackerDevices();
          break;
        case 'HOTKEY_TOGGLE_LIGHTHOUSE_DEVICES':
          await this.toggleLighthouseDevices();
          break;
        case 'HOTKEY_TURN_ON_LIGHTHOUSE_DEVICES':
          await this.turnOnLighthouseDevices();
          break;
        case 'HOTKEY_TURN_OFF_LIGHTHOUSE_DEVICES':
          await this.turnOffLighthouseDevices();
          break;
        default:
          warn("[HotkeyHandlerService] Tried processing unknown hotkey '" + hotkey + "'");
          break;
      }
    });
  }

  private async turnOffControllerDevices() {
    this.openvr.devices
      .pipe(
        take(1),
        map((devices) => devices.filter((d) => d.class === 'Controller')),
        filter((controllers) => controllers.length > 0)
      )
      .subscribe((controllers) => {
        this.lighthouseConsoleService.turnOffDevices(controllers);
        this.eventLog.logEvent({
          type: 'turnedOffOpenVRDevices',
          reason: 'HOTKEY',
          devices: controllers.length > 1 ? 'CONTROLLERS' : 'CONTROLLER',
        } as EventLogTurnedOffOpenVRDevices);
      });
  }

  private async turnOffTrackerDevices() {
    this.openvr.devices
      .pipe(
        take(1),
        map((devices) => devices.filter((d) => d.class === 'GenericTracker')),
        filter((trackers) => trackers.length > 0)
      )
      .subscribe((trackers) => {
        this.lighthouseConsoleService.turnOffDevices(trackers);
        this.eventLog.logEvent({
          type: 'turnedOffOpenVRDevices',
          reason: 'HOTKEY',
          devices: trackers.length > 1 ? 'TRACKERS' : 'TRACKER',
        } as EventLogTurnedOffOpenVRDevices);
      });
  }

  private async toggleLighthouseDevices() {
    const offState = (await firstValueFrom(this.appSettings.settings)).lighthousePowerOffState;
    const devices = (await firstValueFrom(this.lighthouseService.devices)).filter(
      (d) => !this.lighthouseService.isDeviceIgnored(d)
    );
    if (devices.some((d) => d.powerState === 'standby' || d.powerState === 'sleep')) {
      // Power on
      const devicesToPowerOn = devices.filter((d) => !['on', 'booting'].includes(d.powerState));
      devicesToPowerOn.forEach((d) => {
        this.lighthouseService.setPowerState(d, 'on');
      });
      this.eventLog.logEvent({
        type: 'lighthouseSetPowerState',
        reason: 'HOTKEY',
        state: 'on',
        devices: 'ALL',
      } as EventLogLighthouseSetPowerState);
    } else if (!devices.filter((d) => d.powerState !== 'on').length) {
      // Power off
      const devicesToPowerOff = devices.filter((d) => !['standby', 'sleep'].includes(d.powerState));
      devicesToPowerOff.forEach((d) => {
        this.lighthouseService.setPowerState(d, offState);
      });
      this.eventLog.logEvent({
        type: 'lighthouseSetPowerState',
        reason: 'HOTKEY',
        state: offState,
        devices: 'ALL',
      } as EventLogLighthouseSetPowerState);
    }
  }

  private async turnOnLighthouseDevices() {
    this.lighthouseService.devices
      .pipe(
        take(1),
        map((devices) =>
          devices.filter(
            (d) =>
              !this.lighthouseService.isDeviceIgnored(d) &&
              !['on', 'booting'].includes(d.powerState)
          )
        ),
        filter((devices) => devices.length > 0)
      )
      .subscribe((devices) => {
        devices.forEach((device) => {
          this.lighthouseService.setPowerState(device, 'on');
        });
        this.eventLog.logEvent({
          type: 'lighthouseSetPowerState',
          reason: 'HOTKEY',
          state: 'on',
          devices: 'ALL',
        } as EventLogLighthouseSetPowerState);
      });
  }

  private async turnOffLighthouseDevices() {
    const offState = (await firstValueFrom(this.appSettings.settings)).lighthousePowerOffState;
    this.lighthouseService.devices
      .pipe(
        take(1),
        map((devices) =>
          devices.filter(
            (d) =>
              !this.lighthouseService.isDeviceIgnored(d) &&
              !['sleep', 'standby'].includes(d.powerState)
          )
        ),
        filter((devices) => devices.length > 0)
      )
      .subscribe((devices) => {
        devices.forEach((device) => {
          this.lighthouseService.setPowerState(device, offState);
        });
        this.eventLog.logEvent({
          type: 'lighthouseSetPowerState',
          reason: 'HOTKEY',
          state: offState,
          devices: 'ALL',
        } as EventLogLighthouseSetPowerState);
      });
  }
}
