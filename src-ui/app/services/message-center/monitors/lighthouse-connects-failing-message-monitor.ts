import { MessageMonitor } from './message-monitor';
import { commands, events } from '../../../bindings';
import { error } from '@tauri-apps/plugin-log';

const MESSAGE_ID = 'lighthouseConnectsFailing';

export class LighthouseConnectsFailingMessageMonitor extends MessageMonitor {
  // set by a failing streak, cleared by the next successful connect
  private failing = false;
  private restarting = false;
  // set by a successful restart, so the message stays away for the rest of the session
  private restarted = false;

  public override async init(): Promise<void> {
    await events.lighthouseConnectsFailingEvent.listen(() => {
      this.failing = true;
      if (!this.restarting && !this.restarted) this.showMessage(false);
    });
    await events.lighthouseConnectsRecoveredEvent.listen(() => {
      this.failing = false;
      this.messageCenter.removeMessage(MESSAGE_ID);
    });
  }

  private showMessage(restartFailed: boolean) {
    this.messageCenter.addMessage({
      id: MESSAGE_ID,
      title: 'message-center.messages.lighthouseConnectsFailing.title',
      message: restartFailed
        ? 'message-center.messages.lighthouseConnectsFailing.restartFailed'
        : 'message-center.messages.lighthouseConnectsFailing.message',
      type: 'warning',
      hideable: true,
      actions: [
        {
          label: 'message-center.messages.lighthouseConnectsFailing.actions.restartBluetooth',
          action: () => this.restartBluetooth(),
        },
      ],
    });
  }

  private async restartBluetooth() {
    if (this.restarting) return;
    this.restarting = true;
    this.messageCenter.removeMessage(MESSAGE_ID);
    try {
      await commands.lighthouseRestartBluetoothRadio();
      this.restarted = true;
    } catch (e) {
      error(`[LighthouseConnectsFailing] Could not restart the bluetooth radio: ${e}`);
      if (this.failing) this.showMessage(true);
    } finally {
      this.restarting = false;
    }
  }
}
