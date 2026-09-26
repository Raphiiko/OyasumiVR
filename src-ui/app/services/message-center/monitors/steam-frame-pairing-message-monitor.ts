import { inject } from '@angular/core';
import { combineLatest } from 'rxjs';
import { MessageMonitor } from './message-monitor';
import { DMKnownDevice } from '../../../models/device-manager';
import { DeviceManagerService } from '../../device-manager.service';
import { SteamFramePairingService } from '../../steam-frame-pairing.service';

/** Invites pairing for each connected Steam Frame that has no completed pairing. */
export class SteamFramePairingMessageMonitor extends MessageMonitor {
  private deviceManager = inject(DeviceManagerService);
  private framePairing = inject(SteamFramePairingService);
  /** The invitations this monitor shows now, so the stale ones can be removed. */
  private shownIds = new Set<string>();

  public override init() {
    combineLatest([
      this.deviceManager.knownDevices,
      this.deviceManager.observedDevices,
      this.framePairing.pairings$,
    ]).subscribe(([knownDevices, observedIds]) => this.update(knownDevices, observedIds));
  }

  private update(knownDevices: DMKnownDevice[], observedIds: string[]) {
    // invite pairing for each active, unpaired Steam Frame
    const ids = new Set<string>();
    for (const device of knownDevices) {
      if (!observedIds.includes(device.id) || !this.framePairing.identityOf(device)) continue;
      if (this.framePairing.pairingFor(device.id)?.complete) continue;
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
            action: () => this.framePairing.openWizard(device),
          },
        ],
      });
    }

    // remove the invitations that no longer apply
    for (const id of this.shownIds) if (!ids.has(id)) this.messageCenter.removeMessage(id);
    this.shownIds = ids;
  }
}
