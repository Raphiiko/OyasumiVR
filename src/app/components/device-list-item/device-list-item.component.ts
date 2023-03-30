import { Component, Input, OnInit } from '@angular/core';
import { OVRDevice } from 'src/app/models/ovr-device';
import { fade, vshrink } from 'src/app/utils/animations';
import { LighthouseService } from '../../services/lighthouse.service';
import { error } from 'tauri-plugin-log-api';
import { EventLogTurnedOffDevices } from '../../models/event-log-entry';
import { EventLogService } from '../../services/event-log.service';

@Component({
  selector: 'app-device-list-item',
  templateUrl: './device-list-item.component.html',
  styleUrls: ['./device-list-item.component.scss'],
  animations: [fade(), vshrink()],
})
export class DeviceListItemComponent implements OnInit {
  @Input() device: OVRDevice | undefined;

  constructor(private lighthouse: LighthouseService, private eventLog: EventLogService) {}

  ngOnInit(): void {}

  formatBatteryPercentage(battery: number) {
    return Math.floor(battery * 1000) / 10 + '%';
  }

  async turnOffDevice(device: OVRDevice) {
    await this.lighthouse.turnOffDevices([device]);
    this.eventLog.logEvent({
      type: 'turnedOffDevices',
      reason: 'MANUAL',
      devices: (() => {
        switch (device.class) {
          case 'Controller':
            return 'CONTROLLER';
          case 'GenericTracker':
            return 'TRACKER';
          default:
            error(
              `[DeviceListItem] Couldn't determine device class for event log entry (${device.class})`
            );
            return 'VARIOUS';
        }
      })(),
    } as EventLogTurnedOffDevices);
  }
}
