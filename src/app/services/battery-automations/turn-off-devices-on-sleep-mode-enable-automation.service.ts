import { Injectable } from '@angular/core';
import { cloneDeep } from 'lodash';
import { AutomationConfigService } from '../automation-config.service';
import { OpenVRService } from '../openvr.service';
import { filter, firstValueFrom, map, skip } from 'rxjs';
import {
  AUTOMATION_CONFIGS_DEFAULT,
  TurnOffDevicesOnSleepModeEnableAutomationConfig,
} from '../../models/automations';
import { LighthouseConsoleService } from '../lighthouse-console.service';
import { SleepService } from '../sleep.service';
import { EventLogTurnedOffDevices } from '../../models/event-log-entry';
import { EventLogService } from '../event-log.service';
import { error } from 'tauri-plugin-log-api';

@Injectable({
  providedIn: 'root',
})
export class TurnOffDevicesOnSleepModeEnableAutomationService {
  config: TurnOffDevicesOnSleepModeEnableAutomationConfig = cloneDeep(
    AUTOMATION_CONFIGS_DEFAULT.TURN_OFF_DEVICES_ON_SLEEP_MODE_ENABLE
  );

  constructor(
    private automationConfig: AutomationConfigService,
    private openvr: OpenVRService,
    private lighthouse: LighthouseConsoleService,
    private sleepMode: SleepService,
    private eventLog: EventLogService
  ) {}

  async init() {
    this.automationConfig.configs
      .pipe(map((configs) => configs.TURN_OFF_DEVICES_ON_SLEEP_MODE_ENABLE))
      .subscribe((config) => (this.config = config));

    this.sleepMode.mode
      .pipe(
        skip(1), // Skip first value from initial load
        filter((sleepMode) => sleepMode)
      )
      .subscribe(async () => {
        const devices = (await firstValueFrom(this.openvr.devices)).filter(
          (d) => this.config.deviceClasses.includes(d.class) && d.canPowerOff
        );
        if (!devices.length) return;
        await this.lighthouse.turnOffDevices(devices);
        this.eventLog.logEvent({
          type: 'turnedOffDevices',
          reason: 'SLEEP_MODE_ENABLED',
          devices: (() => {
            const classes = devices.map((d) => d.class);
            const total = classes.length;
            const controllers = classes.filter((c) => c === 'Controller').length;
            const trackers = classes.filter((c) => c === 'GenericTracker').length;
            if (controllers > 0 && trackers > 0) return 'ALL';
            if (controllers > 1 && controllers === total) return 'CONTROLLERS';
            if (controllers === 1 && controllers === total) return 'CONTROLLER';
            if (trackers > 1 && trackers === total) return 'TRACKERS';
            if (trackers === 1 && trackers === total) return 'TRACKER';
            error(
              `[TurnOffDevicesOnSleepModeEnableAutomation] Couldn't determine device class for event log entry (${classes})`
            );
            return 'VARIOUS';
          })(),
        } as EventLogTurnedOffDevices);
      });
  }
}
