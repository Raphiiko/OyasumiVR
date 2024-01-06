import { Component, Input, OnInit } from '@angular/core';
import { OVRDevice } from 'src-ui/app/models/ovr-device';
import { fade, hshrink, vshrink } from 'src-ui/app/utils/animations';
import { LighthouseConsoleService } from '../../../services/lighthouse-console.service';
import { error } from 'tauri-plugin-log-api';
import {
  EventLogLighthouseSetPowerState,
  EventLogTurnedOffOpenVRDevices,
} from '../../../models/event-log-entry';
import { EventLogService } from '../../../services/event-log.service';
import { LighthouseDevice } from 'src-ui/app/models/lighthouse-device';
import { LighthouseService } from 'src-ui/app/services/lighthouse.service';
import { AppSettingsService } from 'src-ui/app/services/app-settings.service';
import { firstValueFrom } from 'rxjs';
import {
  DeviceEditModalComponent,
  DeviceEditModalInputModel,
  DeviceEditModalOutputModel,
} from '../device-edit-modal/device-edit-modal.component';
import { ModalService } from 'src-ui/app/services/modal.service';
import { OpenVRService } from '../../../services/openvr.service';

@Component({
  selector: 'app-device-list-item',
  templateUrl: './device-list-item.component.html',
  styleUrls: ['./device-list-item.component.scss'],
  animations: [fade(), vshrink(), hshrink()],
})
export class DeviceListItemComponent implements OnInit {
  @Input() ovrDevice: OVRDevice | undefined;
  @Input() lighthouseDevice: LighthouseDevice | undefined;
  @Input() icon: string | undefined;

  constructor(
    private lighthouseConsole: LighthouseConsoleService,
    private lighthouse: LighthouseService,
    private openvr: OpenVRService,
    private eventLog: EventLogService,
    private appSettings: AppSettingsService,
    private modalService: ModalService
  ) {}

  ngOnInit(): void {}

  protected get deviceName(): string {
    if (this.ovrDevice) {
      return this.ovrDevice.modelNumber;
    }
    if (this.lighthouseDevice) {
      return 'comp.device-list.deviceName.' + this.lighthouseDevice.deviceType;
    }
    return 'comp.device-list.deviceName.unknown';
  }

  protected get deviceIdentifier(): string {
    if (this.ovrDevice) {
      return this.ovrDevice.serialNumber;
    }
    if (this.lighthouseDevice) {
      return this.lighthouseDevice.deviceName;
    }
    return 'unknown';
  }

  protected get deviceRole(): string | null {
    if (this.ovrDevice && this.ovrDevice.handleType) {
      return 'comp.device-list.deviceRole.' + this.ovrDevice.handleType;
    }
    return null;
  }

  protected get deviceNickname(): string | null {
    if (this.ovrDevice) {
      return this.openvr.getDeviceNickname(this.ovrDevice);
    }
    if (this.lighthouseDevice) {
      return this.lighthouse.getDeviceNickname(this.lighthouseDevice);
    }
    return null;
  }

  protected get showBattery(): boolean {
    return Boolean(
      this.ovrDevice && (this.ovrDevice.providesBatteryStatus || this.ovrDevice.isCharging)
    );
  }

  protected get isCharging(): boolean {
    return this.showBattery && this.ovrDevice!.isCharging;
  }

  protected get batteryPercentage(): number {
    return this.showBattery ? this.ovrDevice!.battery * 100 : 0;
  }

  protected get batteryPercentageString(): string {
    return this.showBattery ? Math.floor(this.ovrDevice!.battery * 1000) / 10 + '%' : 0 + '%';
  }

  protected get status(): string | null {
    if (this.lighthouseDevice) {
      return 'comp.device-list.lighthouseStatus.' + this.lighthouseDevice.powerState;
    }
    return null;
  }

  protected get powerButtonState():
    | 'hide'
    | 'turn_off'
    | 'turn_on'
    | 'turn_off_busy'
    | 'turn_on_busy' {
    if (this.ovrDevice) {
      if (this.ovrDevice.isTurningOff) return 'turn_off_busy';
      if (this.ovrDevice.canPowerOff && this.ovrDevice.dongleId) return 'turn_off';
    }
    if (this.lighthouseDevice) {
      if (this.lighthouseDevice.transitioningToPowerState) {
        switch (this.lighthouseDevice.transitioningToPowerState) {
          case 'on':
            return 'turn_on_busy';
          case 'sleep':
          case 'standby':
            return 'turn_off_busy';
          case 'booting':
            return 'turn_on_busy';
          case 'unknown':
          default:
            return 'hide';
        }
      } else {
        switch (this.lighthouseDevice.powerState) {
          case 'on':
            return 'turn_off';
          case 'sleep':
          case 'standby':
            return 'turn_on';
          case 'booting':
            return 'turn_on_busy';
          case 'unknown':
          default:
            return 'hide';
        }
      }
    }
    return 'hide';
  }

  async clickDevicePowerButton() {
    if (this.ovrDevice) {
      await this.lighthouseConsole.turnOffDevices([this.ovrDevice]);
      this.eventLog.logEvent({
        type: 'turnedOffOpenVRDevices',
        reason: 'MANUAL',
        devices: (() => {
          switch (this.ovrDevice.class) {
            case 'Controller':
              return 'CONTROLLER';
            case 'GenericTracker':
              return 'TRACKER';
            default:
              error(
                `[DeviceListItem] Couldn't determine device class for event log entry (${this.ovrDevice.class})`
              );
              return 'VARIOUS';
          }
        })(),
      } as EventLogTurnedOffOpenVRDevices);
    }
    if (this.lighthouseDevice) {
      switch (this.lighthouseDevice.powerState) {
        case 'on': {
          const state = (await firstValueFrom(this.appSettings.settings)).lighthousePowerOffState;
          this.eventLog.logEvent({
            type: 'lighthouseSetPowerState',
            reason: 'MANUAL',
            state,
            devices: 'SINGLE',
          } as EventLogLighthouseSetPowerState);
          await this.lighthouse.setPowerState(this.lighthouseDevice, state);
          break;
        }
        case 'sleep':
        case 'standby':
          this.eventLog.logEvent({
            type: 'lighthouseSetPowerState',
            reason: 'MANUAL',
            state: 'on',
            devices: 'SINGLE',
          } as EventLogLighthouseSetPowerState);
          await this.lighthouse.setPowerState(this.lighthouseDevice, 'on');
          break;
        case 'booting':
        case 'unknown':
        default:
          break;
      }
    }
  }

  editDevice() {
    let input: DeviceEditModalInputModel;
    if (this.ovrDevice) {
      input = {
        deviceType: 'OPENVR',
        ovrDevice: this.ovrDevice,
      };
    } else if (this.lighthouseDevice) {
      input = {
        deviceType: 'LIGHTHOUSE',
        lighthouseDevice: this.lighthouseDevice,
      };
    } else return;
    this.modalService
      .addModal<DeviceEditModalInputModel, DeviceEditModalOutputModel>(
        DeviceEditModalComponent,
        input
      )
      .subscribe();
  }

  isDeviceIgnored() {
    return this.lighthouseDevice && this.lighthouse.isDeviceIgnored(this.lighthouseDevice);
  }
}
