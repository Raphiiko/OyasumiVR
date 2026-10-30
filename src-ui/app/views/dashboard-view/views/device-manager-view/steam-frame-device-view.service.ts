import { Injectable } from '@angular/core';
import { DMKnownDevice } from 'src-ui/app/models/device-manager';
import {
  SteamFrameConnectionState,
  SteamFrameConnectionStatus,
} from 'src-ui/app/models/steam-frame';
import { DeviceManagerService } from 'src-ui/app/services/device-manager.service';
import { ModalService } from 'src-ui/app/services/modal.service';
import { SteamFrameService } from 'src-ui/app/services/steam-frame/steam-frame.service';
import { SteamFrameEnrollmentService } from 'src-ui/app/services/steam-frame/steam-frame-enrollment.service';
import {
  ConfirmModalComponent,
  ConfirmModalInputModel,
  ConfirmModalOutputModel,
} from 'src-ui/app/components/confirm-modal/confirm-modal.component';
import { FLAVOUR } from 'src-ui/build';

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

/** Statuses whose connection loop still runs an update the user requests. */
const UPDATABLE_STATUSES: SteamFrameConnectionStatus[] = [
  'connecting',
  'connected',
  'offline',
  'helperOutdated',
];

const UNREPAIRABLE_STATUSES: (SteamFrameConnectionStatus | undefined)[] = [
  'hostKeyChanged',
  'pairingRemoved',
  'needsAppUpdate',
];

/** The Steam Frame status and actions of one Device Manager device, for the views that show it. */
@Injectable({ providedIn: 'root' })
export class SteamFrameDeviceViewService {
  constructor(
    private deviceManager: DeviceManagerService,
    private modalService: ModalService,
    private steamFrame: SteamFrameService,
    private frameEnrollment: SteamFrameEnrollmentService
  ) {}

  isSupported(device: DMKnownDevice): boolean {
    return !!this.steamFrame.identityOf(device);
  }

  /** Pairing status and action for a supported Steam Frame, or null for any other device. */
  row(device: DMKnownDevice): FrameRow | null {
    if (!this.isSupported(device)) return null;
    const active = this.deviceManager.isDeviceObserved(device.id);
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
    const maintenanceRow = this.maintenanceRow(state);
    if (maintenanceRow) return maintenanceRow;

    // healthy: a badge only
    if (status === 'connected' || status === 'connecting') return { badge: status };

    if (status === 'offline') {
      return { pill: { key: 'offline', icon: 'plug', tone: 'neutral' } };
    }

    // an outdated helper: the pill starts the update
    return { pill: { key: 'updateHelper', icon: 'update', tone: 'warn', startsUpdate: true } };
  }

  private maintenanceRow(state?: SteamFrameConnectionState): FrameRow | null {
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
  onPill(device: DMKnownDevice, pill: FramePill, action?: FrameAction) {
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
        if (!action || !result?.confirmed || this.row(device)?.action !== action) return;
        void this.onAction(device, action);
      });
  }

  onAction(device: DMKnownDevice, action: FrameAction) {
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

  /** The pairing and helper state the device page shows, or null for any other device. */
  details(device: DMKnownDevice) {
    if (!this.isSupported(device)) return null;
    const pairing = this.steamFrame.pairingFor(device.id);
    const state = pairing?.complete ? this.steamFrame.connections()[pairing.id] : undefined;
    const action = this.row(device)?.action;
    if (!pairing?.complete) return { paired: false as const, canPair: action === 'pair' };

    const removedOnHeadset = state?.status === 'pairingRemoved';
    const maintenance = state?.maintenance?.kind;
    return {
      paired: true as const,
      pairing,
      state,
      version: state?.helperVersion ?? pairing.helperVersion,
      updating: maintenance === 'updating',
      canUpdate:
        !!state &&
        UPDATABLE_STATUSES.includes(state.status) &&
        (state.updateAvailable || maintenance === 'failed'),
      // only a helper that answers can be called up to date
      upToDate: state?.status === 'connected' && !state.updateAvailable,
      repairing: !!this.steamFrame.reinstalls()[pairing.id],
      // a repair needs SSH access
      canRepair: !UNREPAIRABLE_STATUSES.includes(state?.status),
      // a headset that no longer knows this PC offers pairing while SteamVR uses it
      pairAgain: action === 'pairAgain' || (removedOnHeadset && action === 'pair'),
      removedOnHeadset,
    };
  }

  updateHelper(device: DMKnownDevice) {
    const pairing = this.steamFrame.pairingFor(device.id);
    if (pairing?.complete) void this.steamFrame.updateHelper(pairing);
  }

  repairHelper(device: DMKnownDevice) {
    const pairing = this.steamFrame.pairingFor(device.id);
    if (pairing?.complete) void this.steamFrame.reinstallHelper(pairing, true);
  }

  async unpair(device: DMKnownDevice) {
    const details = this.details(device);
    if (!details?.paired) return;
    const { SteamFrameUnpairModalComponent } =
      await import('src-ui/app/components/steam-frame/steam-frame-unpair-modal/steam-frame-unpair-modal.component');
    // an unpair keeps running after the dialog closes, so Escape must not look like a cancel
    this.modalService
      .addModal(
        SteamFrameUnpairModalComponent,
        { deviceId: device.id, removedOnHeadset: details.removedOnHeadset },
        { closeOnEscape: false }
      )
      .subscribe();
  }
}
