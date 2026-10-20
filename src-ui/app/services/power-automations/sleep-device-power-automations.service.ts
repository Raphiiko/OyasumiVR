import { Injectable } from '@angular/core';

import { AutomationConfigService } from '../automation-config.service';
import { AUTOMATION_CONFIGS_DEFAULT, DevicePowerAutomationsConfig } from '../../models/automations';
import { DeviceControlService } from '../device-control.service';
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
    private deviceControl: DeviceControlService,
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
    const [[ovrResult], lighthouseResults] = await Promise.all([
      Promise.allSettled([this.deviceControl.turnOffDevices(ovrDevices)]),
      Promise.allSettled(
        lighthouseDevices.map((device) =>
          this.lighthouse.setPowerState(
            device,
            this.appSettings.settingsSync.lighthousePowerOffState
          )
        )
      ),
    ]);

    // find the devices that turned off and the ones that did not
    const dispatched = ovrResult.status === 'fulfilled' ? ovrResult.value : [];
    const failedOvrDevices = ovrDevices.filter(
      (device) => !dispatched.some((d) => d.serialNumber === device.serialNumber)
    );
    const turnedOffLighthouses = lighthouseResults.filter(
      (result) => result.status === 'fulfilled' && result.value
    ).length;
    const failedLighthouses = lighthouseResults.length - turnedOffLighthouses;
    for (const result of [ovrResult, ...lighthouseResults]) {
      if (result.status === 'rejected')
        error(`[DevicePower] Could not turn off a device: ${result.reason}`);
    }

    // log the result
    if (dispatched.length + turnedOffLighthouses > 0) {
      this.eventLog.logEvent({ type: 'turnedOffOpenVRDevices', reason, devices: 'VARIOUS' });
    }
    if (!failedOvrDevices.length && !failedLighthouses) return;
    let failure: EventLogFailure = 'UNKNOWN';
    if (!failedOvrDevices.length) failure = 'BASE_STATION_NO_RESPONSE';
    else if (!failedLighthouses) failure = this.deviceControl.powerOffFailure(failedOvrDevices);
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
