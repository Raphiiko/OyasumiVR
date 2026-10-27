import { Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { DeviceManagerService } from 'src-ui/app/services/device-manager.service';
import { OpenVRService } from 'src-ui/app/services/openvr.service';
import { LighthouseService } from 'src-ui/app/services/lighthouse.service';
import { DeviceControlService } from 'src-ui/app/services/device-control.service';
import { ModalService } from 'src-ui/app/services/modal.service';
import { EventLogService } from 'src-ui/app/services/event-log.service';
import { AppSettingsService } from 'src-ui/app/services/app-settings.service';
import { EventLogLighthouseSetPowerState } from 'src-ui/app/models/event-log-entry';
import { DMDeviceType, DMKnownDevice } from 'src-ui/app/models/device-manager';
import { OVRDevice } from 'src-ui/app/models/ovr-device';
import { LighthouseDevice, LighthouseDevicePowerState } from 'src-ui/app/models/lighthouse-device';
import {
  DevicePowerAction,
  DevicePowerState,
} from 'src-ui/app/components/device-power-button/device-power-button.component';
import {
  ConfirmModalComponent,
  ConfirmModalInputModel,
  ConfirmModalOutputModel,
} from 'src-ui/app/components/confirm-modal/confirm-modal.component';
import {
  LighthouseV1IdWizardModalComponent,
  LighthouseV1IdWizardModalInputModel,
  LighthouseV1IdWizardModalOutputModel,
} from 'src-ui/app/components/lighthouse-v1-id-wizard-modal/lighthouse-v1-id-wizard-modal.component';

/** The live state and the user actions of one Device Manager device, shared by its views. */
@Injectable({ providedIn: 'root' })
export class KnownDeviceViewService {
  private ovrDevices: OVRDevice[] = [];
  private lighthouseDevices: LighthouseDevice[] = [];

  constructor(
    private deviceManager: DeviceManagerService,
    openvr: OpenVRService,
    private lighthouse: LighthouseService,
    private deviceControl: DeviceControlService,
    private modalService: ModalService,
    private eventLog: EventLogService,
    private appSettings: AppSettingsService
  ) {
    // these subscribe before any view, so a view that re-renders on the same emission reads it here
    openvr.devices.subscribe((devices) => (this.ovrDevices = devices));
    lighthouse.devices.subscribe((devices) => (this.lighthouseDevices = devices));
  }

  typeIcon(type: DMDeviceType): string {
    switch (type) {
      case 'HMD':
        return 'headset';
      case 'CONTROLLER':
        return 'controller';
      case 'TRACKER':
        return 'tracker';
      case 'LIGHTHOUSE':
        return 'base-station';
      default:
        return 'device';
    }
  }

  isObserved(device: DMKnownDevice): boolean {
    return this.deviceManager.isDeviceObserved(device.id);
  }

  ovrFor(device: DMKnownDevice): OVRDevice | undefined {
    if (!device.id.startsWith('OVR_')) return undefined;
    return this.ovrDevices.find((d) => this.deviceManager.getIdForOpenVRDevice(d) === device.id);
  }

  lighthouseFor(device: DMKnownDevice): LighthouseDevice | undefined {
    if (!device.id.startsWith('LH_')) return undefined;
    return this.lighthouseDevices.find(
      (d) => this.deviceManager.getIdForLighthouseDevice(d) === device.id
    );
  }

  batteryOf(device: DMKnownDevice): { level: number; isCharging: boolean } | null {
    const ovrDevice = this.ovrFor(device);
    if (!ovrDevice?.providesBatteryStatus) return null;
    return {
      level: Math.round(ovrDevice.battery * 100),
      isCharging: ovrDevice.isCharging || false,
    };
  }

  /** A translation key for the hand a controller is held in, or null. */
  roleKeyOf(device: DMKnownDevice): string | null {
    const handleType = this.ovrFor(device)?.handleType;
    return handleType ? `comp.device-list.deviceRole.${handleType}` : null;
  }

  serialOf(device: DMKnownDevice): string | null {
    return this.ovrFor(device)?.serialNumber || this.lighthouseFor(device)?.deviceName || null;
  }

  powerStateOf(device: DMKnownDevice): DevicePowerState {
    const ovrDevice = this.ovrFor(device);
    if (ovrDevice) {
      if (ovrDevice.isTurningOff) return 'turning-off';
      return ovrDevice.canPowerOff ? 'on' : 'unknown';
    }

    const lighthouseDevice = this.lighthouseFor(device);
    if (!lighthouseDevice) return 'unknown';
    if (this.lighthouse.deviceNeedsIdentifier(lighthouseDevice)) return 'attention';
    switch (lighthouseDevice.transitioningToPowerState ?? lighthouseDevice.powerState) {
      case 'on':
        return lighthouseDevice.transitioningToPowerState ? 'turning-on' : 'on';
      case 'sleep':
      case 'standby':
        return lighthouseDevice.transitioningToPowerState ? 'turning-off' : 'off';
      case 'booting':
        return 'turning-on';
      default:
        return 'unknown';
    }
  }

  canShowPowerButton(device: DMKnownDevice): boolean {
    const ovrDevice = this.ovrFor(device);
    if (ovrDevice) {
      if (ovrDevice.class !== 'Controller' && ovrDevice.class !== 'GenericTracker') return false;
      return ovrDevice.canPowerOff || ovrDevice.isTurningOff;
    }
    return !!this.lighthouseFor(device);
  }

  /**
   * Runs the power button's action. Resolves 'chooseState' for a base station in an unknown
   * state, which only a forced state can change.
   */
  async handlePowerAction(
    device: DMKnownDevice,
    action: DevicePowerAction
  ): Promise<'chooseState' | void> {
    const lighthouseDevice = this.lighthouseFor(device);
    if (lighthouseDevice) {
      if (this.lighthouse.deviceNeedsIdentifier(lighthouseDevice)) {
        await this.openLighthouseV1IdWizard(lighthouseDevice);
        return;
      }
      if (lighthouseDevice.powerState === 'unknown') return 'chooseState';
    }

    if (action === 'power-off') await this.powerOff(device);
    else await this.powerOn(device);
  }

  async forceLighthouseState(device: DMKnownDevice, state: LighthouseDevicePowerState) {
    const lighthouseDevice = this.lighthouseFor(device);
    if (!lighthouseDevice) return;

    if (state === 'on' && lighthouseDevice.powerState === 'on') {
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
      if (!result?.confirmed) return;
    }

    this.logLighthousePowerState(state);
    await this.lighthouse.setPowerStateForUser(
      lighthouseDevice,
      state,
      this.displayName(device),
      true
    );
  }

  async openLighthouseV1IdWizard(lighthouseDevice: LighthouseDevice) {
    await firstValueFrom(
      this.modalService.addModal<
        LighthouseV1IdWizardModalInputModel,
        LighthouseV1IdWizardModalOutputModel
      >(LighthouseV1IdWizardModalComponent, { device: lighthouseDevice }, { closeOnEscape: false })
    );
  }

  private displayName(device: DMKnownDevice): string {
    return device.nickname || device.defaultName;
  }

  private async powerOff(device: DMKnownDevice) {
    const ovrDevice = this.ovrFor(device);
    const lighthouseDevice = this.lighthouseFor(device);
    if (ovrDevice?.canPowerOff) {
      const dispatched = await this.deviceControl.turnOffDeviceForUser(
        ovrDevice,
        this.displayName(device)
      );
      this.eventLog.logTurnedOffOpenVRDevices(dispatched, 'MANUAL');
    } else if (lighthouseDevice) {
      const state = this.appSettings.settingsSync.lighthousePowerOffState;
      this.logLighthousePowerState(state);
      await this.lighthouse.setPowerStateForUser(lighthouseDevice, state, this.displayName(device));
    }
  }

  private async powerOn(device: DMKnownDevice) {
    const lighthouseDevice = this.lighthouseFor(device);
    if (!lighthouseDevice) return;
    this.logLighthousePowerState('on');
    await this.lighthouse.setPowerStateForUser(lighthouseDevice, 'on', this.displayName(device));
  }

  private logLighthousePowerState(state: EventLogLighthouseSetPowerState['state']) {
    this.eventLog.logEvent({
      type: 'lighthouseSetPowerState',
      reason: 'MANUAL',
      state,
      devices: 'SINGLE',
    } as EventLogLighthouseSetPowerState);
  }
}
