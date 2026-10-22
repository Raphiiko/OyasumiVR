import { Injectable } from '@angular/core';

import { AutomationConfigService } from '../automation-config.service';
import { AUTOMATION_CONFIGS_DEFAULT, DevicePowerAutomationsConfig } from '../../models/automations';
import { LighthouseConsoleService } from '../lighthouse-console.service';
import { SleepService } from '../sleep.service';
import { EventLogService } from '../event-log.service';
import { SleepPreparationService } from '../sleep-preparation.service';
import { DeviceManagerService } from '../device-manager.service';
import { LighthouseService } from '../lighthouse.service';
import { AppSettingsService } from '../app-settings.service';
import { map, skip } from 'rxjs';
import { DeviceSelection } from 'src-ui/app/models/device-manager';
import { EventLogFailure, EventLogTurnedOffOpenVRDevices } from 'src-ui/app/models/event-log-entry';
import { error } from '@tauri-apps/plugin-log';

@Injectable({
  providedIn: 'root',
})
export class SleepDevicePowerAutomationsService {
  config: DevicePowerAutomationsConfig = structuredClone(
    AUTOMATION_CONFIGS_DEFAULT.DEVICE_POWER_AUTOMATIONS
  );

  constructor(
    private automationConfig: AutomationConfigService,
    private appSettings: AppSettingsService,
    private lighthouseConsole: LighthouseConsoleService,
    private lighthouse: LighthouseService,
    private sleepMode: SleepService,
    private sleepPreparationService: SleepPreparationService,
    private eventLog: EventLogService,
    private deviceManager: DeviceManagerService
  ) {}

  async init() {
    this.automationConfig.configs
      .pipe(map((configs) => configs.DEVICE_POWER_AUTOMATIONS))
      .subscribe((config) => (this.config = config));

    this.sleepMode.mode.pipe(skip(1)).subscribe((mode) => {
      if (mode) {
        this.handleSleepModeEnable();
      } else {
        this.handleSleepModeDisable();
      }
    });

    this.sleepPreparationService.onSleepPreparation.subscribe(() => {
      this.handleSleepPreparation();
    });
  }

  private async handleSleepPreparation() {
    await this.turnOffSelectedDevices(
      this.config.turnOffDevicesOnSleepPreparation,
      'SLEEP_PREPARATION'
    );
  }

  private async handleSleepModeDisable() {
    await this.turnOffSelectedDevices(
      this.config.turnOffDevicesOnSleepModeDisable,
      'SLEEP_MODE_DISABLED'
    );
    await this.turnOnSelectedDevices(this.config.turnOnDevicesOnSleepModeDisable);
  }

  private async handleSleepModeEnable() {
    await this.turnOffSelectedDevices(
      this.config.turnOffDevicesOnSleepModeEnable,
      'SLEEP_MODE_ENABLED'
    );
  }

  private async turnOffSelectedDevices(
    deviceSelection: DeviceSelection,
    reason: EventLogTurnedOffOpenVRDevices['reason']
  ) {
    const devices = await this.deviceManager.getDevicesForSelection(deviceSelection);
    const ovrDevices = devices.ovrDevices.filter((d) => d.canPowerOff && !d.isTurningOff);
    const lighthouseDevices = devices.lighthouseDevices.filter(
      (d) =>
        (d.powerState === 'on' || d.powerState === 'booting') &&
        !this.lighthouse.deviceNeedsIdentifier(d)
    );
    const [ovrResult, ...lighthouseResults] = await Promise.allSettled([
      this.lighthouseConsole.turnOffDevices(ovrDevices).then((dispatched) => dispatched.length),
      ...lighthouseDevices.map((device) =>
        this.lighthouse
          .setPowerState(device, this.appSettings.settingsSync.lighthousePowerOffState)
          .then((reached) => (reached ? 1 : 0))
      ),
    ]);

    // count the devices that turned off and the ones that did not
    const turnedOff = (result: PromiseSettledResult<number>) =>
      result.status === 'fulfilled' ? result.value : 0;
    const failedOvrDevices = ovrDevices.length - turnedOff(ovrResult);
    const failedLighthouses = lighthouseResults.filter((result) => !turnedOff(result)).length;
    for (const result of [ovrResult, ...lighthouseResults]) {
      if (result.status === 'rejected')
        error(`[DevicePower] Could not turn off a device: ${result.reason}`);
    }

    // log the result
    if (turnedOff(ovrResult) + lighthouseResults.length - failedLighthouses > 0) {
      this.eventLog.logEvent({ type: 'turnedOffOpenVRDevices', reason, devices: 'VARIOUS' });
    }
    if (!failedOvrDevices && !failedLighthouses) return;
    let failure: EventLogFailure = 'UNKNOWN';
    if (!failedOvrDevices) failure = 'BASE_STATION_NO_RESPONSE';
    else if (!failedLighthouses) failure = this.lighthouseConsole.powerOffFailure;
    this.eventLog.logEvent({ type: 'turnedOffOpenVRDevices', reason, devices: 'VARIOUS', failure });
  }

  private async turnOnSelectedDevices(turnOnDevicesOnSleepModeDisable: DeviceSelection) {
    // Get devices to turn on
    const devices = await this.deviceManager.getDevicesForSelection(
      turnOnDevicesOnSleepModeDisable
    );
    // Remove anything that's not a Lighthouse device
    devices.ovrDevices = [];
    devices.knownDevices = devices.knownDevices.filter((d) => d.deviceType === 'LIGHTHOUSE');
    const lighthouseDevices = (devices.lighthouseDevices = devices.lighthouseDevices.filter(
      (d) =>
        d.powerState !== 'on' &&
        d.powerState !== 'booting' &&
        !this.lighthouse.deviceNeedsIdentifier(d)
    ));
    // Turn on devices
    const reached = await Promise.all(
      lighthouseDevices.map((device) => this.lighthouse.setPowerState(device, 'on'))
    );
    this.eventLog.logLighthousePowerState(reached, 'on', 'SLEEP_MODE_DISABLED');
  }
}
