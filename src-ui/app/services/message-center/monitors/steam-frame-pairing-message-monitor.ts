import { inject } from '@angular/core';
import { combineLatest } from 'rxjs';
import { MessageMonitor } from './message-monitor';
import { DMKnownDevice } from '../../../models/device-manager';
import { DeviceManagerService } from '../../device-manager.service';
import { SteamFrameService } from '../../steam-frame/steam-frame.service';
import { SteamFrameEnrollmentService } from '../../steam-frame/steam-frame-enrollment.service';

/** Invites pairing for each connected Steam Frame without a completed pairing the headset keeps. */
export class SteamFramePairingMessageMonitor extends MessageMonitor {
  private deviceManager = inject(DeviceManagerService);
  private steamFrame = inject(SteamFrameService);
  private frameEnrollment = inject(SteamFrameEnrollmentService);
  /** The invitations this monitor shows now, so the stale ones can be removed. */
  private shownIds = new Set<string>();

  public override init() {
    combineLatest([
      this.deviceManager.knownDevices,
      this.deviceManager.observedDevices,
      this.steamFrame.pairings$,
      this.steamFrame.connections$,
    ]).subscribe(([knownDevices, observedIds]) => this.update(knownDevices, observedIds));
  }

  private update(knownDevices: DMKnownDevice[], observedIds: string[]) {
    // invite pairing for each active, unpaired Steam Frame
    const ids = new Set<string>();
    for (const device of knownDevices) {
      if (!observedIds.includes(device.id) || !this.steamFrame.identityOf(device)) continue;
      const pairing = this.steamFrame.pairingFor(device.id);
      const status = pairing && this.steamFrame.connections()[pairing.id]?.status;
      if (pairing?.complete && status !== 'pairingRemoved') continue;
      const id = `framePairable-${device.id}`;
      ids.add(id);
      this.messageCenter.addMessage({
        id,
        title: 'steamFrame.invitation.title',
        message: 'steamFrame.invitation.body',
        hideable: true,
        type: 'info',
        actions: [
          {
            label: 'steamFrame.actions.pair',
            action: () => this.frameEnrollment.openWizard(device),
          },
        ],
      });
    }

    // remove the invitations that no longer apply
    for (const id of this.shownIds) if (!ids.has(id)) this.messageCenter.removeMessage(id);
    this.shownIds = ids;
  }
}
