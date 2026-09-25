import { inject } from '@angular/core';
import { combineLatest } from 'rxjs';
import { MessageMonitor } from './message-monitor';
import { DeviceManagerService } from '../../device-manager.service';
import { FramePairingService } from '../../frame-pairing.service';

/** Invites pairing for each connected Steam Frame that has no completed pairing. */
export class FramePairingMessageMonitor extends MessageMonitor {
  private deviceManager = inject(DeviceManagerService);
  private framePairing = inject(FramePairingService);
  private shownIds = new Set<string>();

  public override init() {
    combineLatest([
      this.deviceManager.knownDevices,
      this.deviceManager.observedDevices,
      this.framePairing.pairings$,
    ]).subscribe(([knownDevices, observedIds]) => {
      const ids = new Set<string>();
      for (const device of knownDevices) {
        if (!observedIds.includes(device.id) || !this.framePairing.identityOf(device)) continue;
        if (this.framePairing.pairingFor(device.id)?.complete) continue;
        const id = `framePairable-${device.id}`;
        ids.add(id);
        this.messageCenter.addMessage({
          id,
          title: 'frame.invitation.title',
          message: 'frame.invitation.body',
          hideable: true,
          type: 'info',
          actions: [
            {
              label: 'frame.actions.pair',
              action: () => this.framePairing.openWizard(device),
            },
          ],
        });
      }
      for (const id of this.shownIds) if (!ids.has(id)) this.messageCenter.removeMessage(id);
      this.shownIds = ids;
    });
  }
}
