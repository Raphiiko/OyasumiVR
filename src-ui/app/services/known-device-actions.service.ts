import { Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { DeviceManagerService } from './device-manager.service';
import { OpenVRService } from './openvr.service';
import { LighthouseService } from './lighthouse.service';
import { DeviceControlService } from './device-control.service';
import { ModalService } from './modal.service';
import { EventLogService } from './event-log.service';
import { AppSettingsService } from './app-settings.service';
import { SteamFrameService } from './steam-frame/steam-frame.service';
import { SteamFrameEnrollmentService } from './steam-frame/steam-frame-enrollment.service';
import { EventLogLighthouseSetPowerState } from '../models/event-log-entry';
import { DMDeviceType, DMKnownDevice } from '../models/device-manager';
import { OVRDevice } from '../models/ovr-device';
import { LighthouseDevice, LighthouseDevicePowerState } from '../models/lighthouse-device';
import { SteamFrameConnectionState, SteamFrameConnectionStatus } from '../models/steam-frame';
import {
  DevicePowerAction,
  DevicePowerState,
} from '../components/device-power-button/device-power-button.component';
import {
  ConfirmModalComponent,
  ConfirmModalInputModel,
  ConfirmModalOutputModel,
} from '../components/confirm-modal/confirm-modal.component';
import {
  LighthouseV1IdWizardModalComponent,
  LighthouseV1IdWizardModalInputModel,
  LighthouseV1IdWizardModalOutputModel,
} from '../components/lighthouse-v1-id-wizard-modal/lighthouse-v1-id-wizard-modal.component';
import { FLAVOUR } from '../../build';

export interface FramePill {
  key: string;
  icon: string;
  tone: 'neutral' | 'warn' | 'bad';
  params?: Record<string, string>;
  /** A key under `steamFrame.statusDetail` whose title and body explain the pill when clicked. */
  detail?: string;
  /** Clicking the pill starts a helper update instead of explaining it. */
  startsUpdate?: boolean;
}

export type FrameAction = 'pair' | 'pairAgain' | 'retryUpdate' | 'reinstall';

/** A healthy Frame gets only a badge on its icon; any other state gets only a pill. */
export interface FrameRow {
  badge?: 'connected' | 'connecting';
  pill?: FramePill;
  action?: FrameAction;
}

/** Statuses that outrank helper maintenance, with their pill and action. */
const FRAME_STATUS_ROWS: Partial<Record<SteamFrameConnectionStatus, FrameRow>> = {
  hostKeyChanged: {
    pill: {
      key: 'notRecognized',
      icon: 'exclamation-circle',
      tone: 'bad',
      detail: 'notRecognized',
    },
    action: 'pairAgain',
  },
  helperMissing: {
    pill: {
      key: 'helperMissing',
      icon: 'exclamation-circle',
      tone: 'bad',
      detail: 'helperMissing',
    },
    action: 'reinstall',
  },
  needsAppUpdate: {
    pill: {
      key: 'updateApp',
      icon: 'update',
      tone: 'warn',
      detail: FLAVOUR === 'STEAM' ? 'needsAppUpdateSteam' : 'needsAppUpdate',
    },
  },
};

/** The live state and the user actions of one Device Manager device, shared by its views. */
@Injectable({ providedIn: 'root' })
export class KnownDeviceActionsService {
  private ovrDevices: OVRDevice[] = [];
  private lighthouseDevices: LighthouseDevice[] = [];

  constructor(
    private deviceManager: DeviceManagerService,
    openvr: OpenVRService,
    private lighthouse: LighthouseService,
    private deviceControl: DeviceControlService,
    private modalService: ModalService,
    private eventLog: EventLogService,
    private appSettings: AppSettingsService,
    private steamFrame: SteamFrameService,
    private frameEnrollment: SteamFrameEnrollmentService
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

  /** Pairing status and action for a supported Steam Frame, or null for any other device. */
  frameRow(device: DMKnownDevice): FrameRow | null {
    if (!this.steamFrame.identityOf(device)) return null;
    const active = this.isObserved(device);
    const pairing = this.steamFrame.pairingFor(device.id);

    // unpaired, or the headset removed the pairing: offer pairing while SteamVR uses it
    const state = pairing?.complete ? this.steamFrame.connections()[pairing.id] : undefined;
    const status = state?.status ?? 'connecting';
    if (!pairing?.complete || status === 'pairingRemoved')
      return active ? { action: 'pair' } : null;

    // a reinstall from this row
    if (this.steamFrame.reinstalls()[pairing.id]) {
      return { pill: { key: 'reinstalling', icon: 'refresh', tone: 'neutral' } };
    }

    // a problem: its pill, and Pair again only while SteamVR uses it
    const statusRow = FRAME_STATUS_ROWS[status];
    if (statusRow) {
      return statusRow.action === 'pairAgain' && !active ? { pill: statusRow.pill } : statusRow;
    }

    // a helper update in progress or just finished
    const maintenanceRow = this.frameMaintenanceRow(state);
    if (maintenanceRow) return maintenanceRow;

    // healthy: a badge only
    if (status === 'connected' || status === 'connecting') return { badge: status };

    if (status === 'offline') {
      return { pill: { key: 'offline', icon: 'plug', tone: 'neutral' } };
    }

    // an outdated helper: the pill starts the update
    return { pill: { key: 'updateHelper', icon: 'update', tone: 'warn', startsUpdate: true } };
  }

  private frameMaintenanceRow(state?: SteamFrameConnectionState): FrameRow | null {
    const maintenance = state?.maintenance;
    switch (maintenance?.kind) {
      case 'updating':
        return { pill: { key: 'updatingHelper', icon: 'refresh', tone: 'neutral' } };
      case 'updated':
        return {
          pill: {
            key: 'helperUpdated',
            icon: 'check-circle',
            tone: 'neutral',
            params: { version: maintenance.version },
          },
        };
      case 'failed':
        return {
          pill: {
            key: 'updateFailed',
            icon: 'exclamation-circle',
            tone: 'bad',
            detail: 'updateFailed',
          },
          action: 'retryUpdate',
        };
      default:
        return null;
    }
  }

  /**
   * Starts the update from an Update helper pill, and opens the explanation for any other.
   * The explanation offers the row's action as its main button.
   */
  onFramePill(device: DMKnownDevice, pill: FramePill, action?: FrameAction) {
    const pairing = this.steamFrame.pairingFor(device.id);
    if (pill.startsUpdate) {
      if (pairing) void this.steamFrame.updateHelper(pairing);
      return;
    }
    this.modalService
      .addModal<ConfirmModalInputModel, ConfirmModalOutputModel>(ConfirmModalComponent, {
        title: `steamFrame.statusDetail.${pill.detail}.title`,
        message: `steamFrame.statusDetail.${pill.detail}.body`,
        confirmButtonText: action ? `steamFrame.actions.${action}` : 'shared.modals.close',
        cancelButtonText: 'shared.modals.close',
        showCancel: !!action,
      })
      .subscribe((result) => {
        // the row can change while the explanation is open
        if (!action || !result?.confirmed || this.frameRow(device)?.action !== action) return;
        void this.onFrameAction(device, action);
      });
  }

  onFrameAction(device: DMKnownDevice, action: FrameAction) {
    const pairing = this.steamFrame.pairingFor(device.id);
    switch (action) {
      case 'pair':
      case 'pairAgain':
        return this.frameEnrollment.openWizard(device);
      case 'retryUpdate':
        return pairing && this.steamFrame.updateHelper(pairing);
      case 'reinstall':
        return pairing && this.steamFrame.reinstallHelper(pairing);
    }
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
