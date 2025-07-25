import { Component, DestroyRef, Input, OnInit } from '@angular/core';
import { OVRDevice } from 'src-ui/app/models/ovr-device';
import { fade, hshrink, vshrink } from 'src-ui/app/utils/animations';
import { LighthouseConsoleService } from '../../../services/lighthouse-console.service';
import { error } from '@tauri-apps/plugin-log';
import {
  EventLogLighthouseSetPowerState,
  EventLogTurnedOffOpenVRDevices,
} from '../../../models/event-log-entry';
import { EventLogService } from '../../../services/event-log.service';
import { LighthouseDevice, LighthouseDevicePowerState } from 'src-ui/app/models/lighthouse-device';
import { LighthouseService } from 'src-ui/app/services/lighthouse.service';
import { AppSettingsService } from 'src-ui/app/services/app-settings.service';
import { distinctUntilChanged, firstValueFrom, map, skip } from 'rxjs';
import { ModalService } from 'src-ui/app/services/modal.service';
import { OpenVRService } from '../../../services/openvr.service';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  ConfirmModalComponent,
  ConfirmModalInputModel,
  ConfirmModalOutputModel,
} from '../../confirm-modal/confirm-modal.component';
import {
  LighthouseV1IdWizardModalComponent,
  LighthouseV1IdWizardModalInputModel,
  LighthouseV1IdWizardModalOutputModel,
} from '../../lighthouse-v1-id-wizard-modal/lighthouse-v1-id-wizard-modal.component';
import {
  DevicePowerState,
  DevicePowerAction,
} from '../../device-power-button/device-power-button.component';
import { isEqual } from 'lodash';
import { DeviceManagerService } from 'src-ui/app/services/device-manager.service';

@Component({
  selector: 'app-device-list-item',
  templateUrl: './device-list-item.component.html',
  styleUrls: ['./device-list-item.component.scss'],
  animations: [fade(), vshrink(), hshrink()],
  standalone: false,
})
export class DeviceListItemComponent implements OnInit {
  @Input() icon: string | undefined;

  @Input() set ovrDevice(device: OVRDevice | undefined) {
    if (!device) return;
    this._lighthouseDevice = undefined;
    this._ovrDevice = device;
    const knownDevice = this.deviceManager.getKnownDeviceById(
      this.deviceManager.getIdForOpenVRDevice(device)
    );
    if (!knownDevice) return;

    this.mode = 'openvr';
    this.deviceTypeName = knownDevice.typeName;
    this.deviceName = knownDevice.nickname ?? knownDevice.defaultName;
    this.showBattery = Boolean(device.providesBatteryStatus || device.isCharging);
    this.isCharging = this.showBattery && (device.isCharging ?? false);
    this.batteryPercentage = this.showBattery ? device.battery * 100 : 0;
    this.batteryPercentageString = this.showBattery
      ? Math.floor(device.battery * 1000) / 10 + '%'
      : 0 + '%';
    this.status = null;
    if (device.isTurningOff) this.powerButtonState = 'turn_off_busy';
    else if (device.canPowerOff && device.dongleId) this.powerButtonState = 'turn_off';
    else this.powerButtonState = 'hide';
    this.cssId = this.sanitizeIdentifierForCSS(device.serialNumber ?? '');
    this.powerButtonAnchorId = '--anchor-device-pwr-btn-' + this.cssId;
    this.showLHStatePopover = false;
  }

  @Input() set lighthouseDevice(device: LighthouseDevice | undefined) {
    if (!device) return;
    this._lighthouseDevice = device;
    this._ovrDevice = undefined;
    const knownDevice = this.deviceManager.getKnownDeviceById(
      this.deviceManager.getIdForLighthouseDevice(device)
    );
    if (!knownDevice) return;

    this.mode = 'lighthouse';
    this.deviceTypeName = knownDevice.typeName;
    this.deviceName = knownDevice.nickname ?? knownDevice.defaultName;
    this.showBattery = false;
    this.isCharging = false;
    this.batteryPercentage = 100;
    this.batteryPercentageString = '100%';
    switch (device.powerState) {
      case 'unknown':
        this.status = null;
        break;
      default:
        this.status = 'comp.device-list.lighthouseStatus.' + device.powerState;
        break;
    }
    this.powerButtonState = (() => {
      if (this.lighthouse.deviceNeedsIdentifier(device)) {
        return 'attention';
      }
      if (device.transitioningToPowerState) {
        switch (device.transitioningToPowerState) {
          case 'on':
            return 'turn_on_busy';
          case 'sleep':
          case 'standby':
            return 'turn_off_busy';
          case 'booting':
            return 'turn_on_busy';
          case 'unknown':
          default:
            return 'turn_on_off_busy';
        }
      } else {
        switch (device.powerState) {
          case 'on':
            return 'turn_off';
          case 'sleep':
          case 'standby':
            return 'turn_on';
          case 'booting':
            return 'turn_on_busy';
          case 'unknown':
          default:
            return 'turn_on_off';
        }
      }
    })();
    this.cssId = this.sanitizeIdentifierForCSS(device.id);
    this.powerButtonAnchorId = '--anchor-device-pwr-btn-' + this.cssId;
  }

  mode?: 'lighthouse' | 'openvr';
  deviceTypeName = '';
  deviceName = '';
  showBattery = false;
  isCharging = false;
  batteryPercentage = 100;
  batteryPercentageString = '100%';
  status: string | null = null;
  powerButtonState:
    | 'hide'
    | 'attention'
    | 'turn_on_off'
    | 'turn_on_off_busy'
    | 'turn_off'
    | 'turn_on'
    | 'turn_off_busy'
    | 'turn_on_busy' = 'hide';
  powerButtonAnchorId = '';
  showLHStatePopover = false;
  cssId = '';
  _lighthouseDevice?: LighthouseDevice;
  _ovrDevice?: OVRDevice;

  constructor(
    private lighthouseConsole: LighthouseConsoleService,
    private lighthouse: LighthouseService,
    private openvr: OpenVRService,
    private eventLog: EventLogService,
    private appSettings: AppSettingsService,
    private destroyRef: DestroyRef,
    private modalService: ModalService,
    private deviceManager: DeviceManagerService
  ) {}

  ngOnInit(): void {
    // Retrigger the setters when devices have updated
    this.openvr.devices.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      if (this._ovrDevice) this.ovrDevice = this._ovrDevice;
    });
    this.lighthouse.devices.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      if (this._lighthouseDevice) this.lighthouseDevice = this._lighthouseDevice;
    });
    this.appSettings.settings
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        map((s) => s.v1LighthouseIdentifiers),
        distinctUntilChanged((a, b) => isEqual(a, b)),
        skip(1)
      )
      .subscribe(() => {
        if (this._lighthouseDevice) this.lighthouseDevice = this._lighthouseDevice;
      });
    this.deviceManager.knownDevices.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => {
      if (this._ovrDevice) this.ovrDevice = this._ovrDevice;
      if (this._lighthouseDevice) this.lighthouseDevice = this._lighthouseDevice;
    });
  }

  async onForceLHState(state: LighthouseDevicePowerState) {
    this.showLHStatePopover = false;
    if (state === 'on' && this._lighthouseDevice?.powerState === 'on') {
      const result = await firstValueFrom(
        this.modalService.addModal<ConfirmModalInputModel, ConfirmModalOutputModel>(
          ConfirmModalComponent,
          {
            title: 'comp.device-list.forceOnBootingWarning.title',
            message: 'comp.device-list.forceOnBootingWarning.message',
            confirmButtonText: 'comp.device-list.lhForceState.on',
          }
        )
      );
      if (!result || !result.confirmed) return;
    }
    this.eventLog.logEvent({
      type: 'lighthouseSetPowerState',
      reason: 'MANUAL',
      state,
      devices: 'SINGLE',
    } as EventLogLighthouseSetPowerState);
    await this.lighthouse.setPowerState(this._lighthouseDevice!, state, true);
  }

  rightClickDevicePowerButton() {
    if (this._lighthouseDevice && !this.lighthouse.deviceNeedsIdentifier(this._lighthouseDevice)) {
      this.showLHStatePopover = !this.showLHStatePopover;
    }
  }

  async clickDevicePowerButton() {
    if (this.mode === 'openvr') {
      await this.lighthouseConsole.turnOffDevices([this._ovrDevice!]);
      this.eventLog.logEvent({
        type: 'turnedOffOpenVRDevices',
        reason: 'MANUAL',
        devices: (() => {
          switch (this._ovrDevice!.class) {
            case 'Controller':
              return 'CONTROLLER';
            case 'GenericTracker':
              return 'TRACKER';
            default:
              error(
                `[DeviceListItem] Couldn't determine device class for event log entry (${
                  this._ovrDevice!.class
                })`
              );
              return 'VARIOUS';
          }
        })(),
      } as EventLogTurnedOffOpenVRDevices);
    }
    if (this.mode === 'lighthouse') {
      if (this.lighthouse.deviceNeedsIdentifier(this._lighthouseDevice!)) {
        this.modalService
          .addModal<
            LighthouseV1IdWizardModalInputModel,
            LighthouseV1IdWizardModalOutputModel
          >(LighthouseV1IdWizardModalComponent, { device: this._lighthouseDevice! }, { closeOnEscape: false })
          .subscribe();
        return;
      }
      switch (this._lighthouseDevice!.powerState) {
        case 'on': {
          const state = (await firstValueFrom(this.appSettings.settings)).lighthousePowerOffState;
          this.eventLog.logEvent({
            type: 'lighthouseSetPowerState',
            reason: 'MANUAL',
            state,
            devices: 'SINGLE',
          } as EventLogLighthouseSetPowerState);
          await this.lighthouse.setPowerState(this._lighthouseDevice!, state);
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
          await this.lighthouse.setPowerState(this._lighthouseDevice!, 'on');
          break;
        case 'unknown':
          this.rightClickDevicePowerButton();
          break;
        case 'booting':
        default:
          break;
      }
    }
  }

  private sanitizeIdentifierForCSS(serialNumber: string) {
    return serialNumber.replace(/[^a-zA-Z0-9]/g, '');
  }

  onClickOutsideLHStatePopover($event: MouseEvent) {
    const targetId = ($event.target as HTMLElement).id;
    if (targetId === 'btn-power-' + this.cssId) return;
    this.showLHStatePopover = false;
  }

  // Helper methods for the new power button component
  getDevicePowerState(): DevicePowerState {
    switch (this.powerButtonState) {
      case 'turn_off':
        return 'on';
      case 'turn_on':
        return 'off';
      case 'turn_off_busy':
        return 'turning-off';
      case 'turn_on_busy':
        return 'turning-on';
      case 'attention':
        return 'attention';
      case 'turn_on_off':
      case 'turn_on_off_busy':
      case 'hide':
      default:
        return 'unknown';
    }
  }

  canShowPowerButton(): boolean {
    return this.powerButtonState !== 'hide';
  }

  async handleDevicePowerAction(action: DevicePowerAction) {
    if (action === 'power-off' || action === 'power-on') {
      await this.clickDevicePowerButton();
    }
  }
}
