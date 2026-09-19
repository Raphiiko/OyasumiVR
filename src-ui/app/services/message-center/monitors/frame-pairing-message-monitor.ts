import { effect, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { DeviceManagerService } from '../../device-manager.service';
import { FramePairingService } from '../../frame-pairing.service';
import { MessageMonitor } from './message-monitor';

export class FramePairingMessageMonitor extends MessageMonitor {
  private readonly pairing = inject(FramePairingService);
  private readonly devices = toSignal(inject(DeviceManagerService).knownDevices, {
    initialValue: [],
  });
  private invitedId?: string;
  private readonly monitor = effect(() => {
    const device = this.devices().find(
      (device) => this.pairing.supported(device) && !this.pairing.forDevice(device.id)?.paired
    );
    if (device?.id === this.invitedId) return;
    this.invitedId = device?.id;
    queueMicrotask(() => {
      if (!device) {
        this.messageCenter.removeMessage('frame-pairing-invitation');
        return;
      }
      this.messageCenter.addMessage({
        id: 'frame-pairing-invitation',
        title: 'frame.invitation.title',
        message: 'frame.invitation.body',
        type: 'info',
        hideable: true,
        actions: [{ label: 'frame.actions.pair', action: () => this.pairing.open(device) }],
      });
    });
  });

  override init() {
    return this.pairing.init();
  }
}
