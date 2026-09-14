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
import { LighthouseDevice } from 'src-ui/app/models/lighthouse-device';
import {
  EventLogLighthouseSetPowerState,
  EventLogTurnedOffOpenVRDevices,
} from 'src-ui/app/models/event-log-entry';

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
    const onResult = await this.turnOnSelectedDevices(this.config.turnOnDevicesOnSleepModeDisable);
    const onDevices = onResult.lighthouseDevices.length;
    if (onDevices > 0) {
      this.eventLog.logEvent({
        type: 'lighthouseSetPowerState',
        reason: 'SLEEP_MODE_DISABLED',
        devices: onDevices === 1 ? 'SINGLE' : 'VARIOUS',
        state: 'on',
      } as EventLogLighthouseSetPowerState);
    }
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
    const ovrDevices = devices.ovrDevices.filter((d) => d.canPowerOff);
    const lighthouseDevices = devices.lighthouseDevices.filter(
      (d) =>
        (d.powerState === 'on' || d.powerState === 'booting') &&
        !this.lighthouse.deviceNeedsIdentifier(d)
    );
    const results = await Promise.allSettled([
      this.lighthouseConsole.turnOffDevices(ovrDevices).then((dispatched) => dispatched.length),
      ...lighthouseDevices.map((device) =>
        this.lighthouse
          .setPowerState(device, this.appSettings.settingsSync.lighthousePowerOffState)
          .then(() => 1)
      ),
    ]);
    if (results.some((result) => result.status === 'fulfilled' && result.value > 0)) {
      this.eventLog.logEvent({ type: 'turnedOffOpenVRDevices', reason, devices: 'VARIOUS' });
    }
    const failure = results.find((result) => result.status === 'rejected');
    if (failure) throw failure.reason;
  }

  private async turnOnSelectedDevices(turnOnDevicesOnSleepModeDisable: DeviceSelection): Promise<{
    lighthouseDevices: LighthouseDevice[];
  }> {
    // Get devices to turn on
    const devices = await this.deviceManager.getDevicesForSelection(
      turnOnDevicesOnSleepModeDisable
    );
    // Remove anything that's not a Lighthouse device
    devices.ovrDevices = [];
    devices.knownDevices = devices.knownDevices.filter((d) => d.deviceType === 'LIGHTHOUSE');
    const lighthouseDevices = (devices.lighthouseDevices = devices.lighthouseDevices.filter(
      (d) => d.powerState !== 'on' && d.powerState !== 'booting'
    ));
    // Turn on devices
    await Promise.all([
      // Turn on available Lighthouse devices
      ...lighthouseDevices.map((device) => this.lighthouse.setPowerState(device, 'on')),
    ]);

    return { lighthouseDevices };
  }
}
