import { MessageMonitor } from './message-monitor';
import { listen } from '@tauri-apps/api/event';
import { appLogDir } from '@tauri-apps/api/path';
import { invoke } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import { error } from '@tauri-apps/plugin-log';

const MESSAGE_ID = 'lighthouseConnectsFailing';

export class LighthouseConnectsFailingMessageMonitor extends MessageMonitor {
  // set by a failing streak, cleared by the next successful connect
  private failing = false;

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
      actions: [
        {
          label: 'message-center.messages.lighthouseConnectsFailing.actions.restartBluetooth',
          action: () => this.restartBluetooth(),
        },
        {
          label: 'message-center.actions.openLogFolder',
          action: async () => {
            const path = (await appLogDir()) + '\\OyasumiVR.log';
            await invoke('show_in_folder', { path });
          },
        },
        {
          label: 'message-center.actions.supportDiscord',
          action: () => openUrl('https://discord.gg/7MqdPJhYxC'),
        },
      ],
    });
  }

  private async restartBluetooth() {
    try {
      await invoke('lighthouse_restart_bluetooth_radio');
    } catch (e) {
      error(`[LighthouseConnectsFailing] Could not restart the bluetooth radio: ${e}`);
      if (this.failing) this.showMessage(true);
    }
  }
}
