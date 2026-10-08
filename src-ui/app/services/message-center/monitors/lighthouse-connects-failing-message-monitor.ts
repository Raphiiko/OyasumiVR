import { MessageMonitor } from './message-monitor';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { error } from '@tauri-apps/plugin-log';

const MESSAGE_ID = 'lighthouseConnectsFailing';

export class LighthouseConnectsFailingMessageMonitor extends MessageMonitor {
  // set by a failing streak, cleared by the next successful connect
  private failing = false;
  private restarting = false;

  public override async init(): Promise<void> {
    await listen('LIGHTHOUSE_CONNECTS_FAILING', () => {
      this.failing = true;
      this.showMessage(false);
    });
    await listen('LIGHTHOUSE_CONNECTS_RECOVERED', () => {
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
    try {
      await invoke('lighthouse_restart_bluetooth_radio');
    } catch (e) {
      error(`[LighthouseConnectsFailing] Could not restart the bluetooth radio: ${e}`);
      if (this.failing) this.showMessage(true);
    } finally {
      this.restarting = false;
    }
  }
}
