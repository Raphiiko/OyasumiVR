import { Injectable } from '@angular/core';
import { getVersion } from '../utils/app-utils';
import { invoke } from '@tauri-apps/api';
import * as DesktopNotifications from '@tauri-apps/api/notification';
import { AppSettingsService } from './app-settings.service';
import { debounceTime, distinctUntilChanged, firstValueFrom, interval, map } from 'rxjs';
import { APP_ICON_ARR, APP_ICON_B64 } from '../globals';
import { NotificationProvider, NotificationType } from '../models/settings';
import { error, info, warn } from 'tauri-plugin-log-api';
import { IPCService } from './ipc.service';
import { AddNotificationRequest } from '../../../src-grpc-web-client/oyasumi-core_pb';
import { listen } from '@tauri-apps/api/event';
import { NotificationSound } from '../models/notification-sounds.generated';

interface XSOMessage {
  messageType: number;
  index: number;
  volume: number;
  audioPath: string;
  timeout: number;
  title: string;
  content: string;
  icon: string;
  height: number;
  opacity: number;
  useBase64Icon: boolean;
  sourceApp: string;
}

@Injectable({
  providedIn: 'root',
})
export class NotificationService {
  private ovrtSocket?: WebSocket;

  constructor(private appSettingsService: AppSettingsService, private ipcService: IPCService) {}

  public async init() {
    await listen<AddNotificationRequest>('addNotification', async (request) => {
      /*const notificationId = */
      await this.send(request.payload.message, request.payload.duration);
      // TODO: SEND BACK NOTIFICATION ID TO CORE
    });
    await this.manageOVRTSocketConnection();
  }

  public async playSound(sound: NotificationSound, volume: number | null = null) {
    if (volume === null) {
      const settings = await firstValueFrom(this.appSettingsService.settings);
      volume = settings.generalNotificationVolume / 100.0;
    }
    if (volume > 0) {
      await invoke('play_sound', {
        name: sound,
        volume,
      });
    }
  }

  public async send(content: string, duration = 3000): Promise<string | null> {
    try {
      const settings = await firstValueFrom(this.appSettingsService.settings);
      info(`[Notification] Sending notification (${duration}ms): "${content}"`);
      switch (settings.notificationProvider) {
        case 'OYASUMIVR':
          return await this.sendOyasumiNotification(content, duration);
        case 'XSOVERLAY':
          return await this.sendXSOverlayNotification('OyasumiVR', content, false, duration / 1000);
        case 'DESKTOP':
          return await this.sendDesktopNotification('OyasumiVR', content);
        case 'OVRTOOLKIT':
          return await this.sendOVRToolkitNotification('OyasumiVR', content);
      }
    } catch (e) {
      warn('[Notification] Failed to send notification: ' + e);
    }
    return null;
  }

  async clearNotification(notificationId: string) {
    const settings = await firstValueFrom(this.appSettingsService.settings);
    switch (settings.notificationProvider) {
      case 'OYASUMIVR':
        await this.clearOyasumiNotification(notificationId);
        break;
      case 'XSOVERLAY':
      case 'DESKTOP':
      case 'OVRTOOLKIT':
      default:
    }
  }

  public async notificationTypeEnabled(type: NotificationType): Promise<boolean> {
    return firstValueFrom(
      this.appSettingsService.settings.pipe(
        map((settings) => settings.notificationsEnabled.types.includes(type))
      )
    );
  }

  public async setProvider(provider: NotificationProvider) {
    switch (provider) {
      case 'OVRTOOLKIT':
        break;
      case 'OYASUMIVR':
        break;
      case 'XSOVERLAY':
        break;
      case 'DESKTOP': {
        // Check for permissions
        let permissionGranted = await DesktopNotifications.isPermissionGranted();
        // Attempt requesting permissions
        if (!permissionGranted) {
          const permission = await DesktopNotifications.requestPermission();
          permissionGranted = permission === 'granted';
        }
        // Stop here and fall back to OYASUMI provider if permissions are not granted
        if (!permissionGranted) {
          this.appSettingsService.updateSettings({ notificationProvider: 'OYASUMIVR' });
          return;
        }
        break;
      }
    }
    this.appSettingsService.updateSettings({ notificationProvider: provider });
  }

  private async clearOyasumiNotification(notificationId: string) {
    const client = await firstValueFrom(this.ipcService.overlaySidecarClient);
    if (!client) return;
    await client.clearNotification({
      notificationId,
    });
  }

  private async sendOyasumiNotification(content: string, duration: number): Promise<string | null> {
    const client = await firstValueFrom(this.ipcService.overlaySidecarClient);
    if (!client) return null;
    const result = await client.addNotification({
      message: content,
      duration,
    });
    return result.response.notificationId ?? null;
  }

  private async sendDesktopNotification(title: string, content: string): Promise<string | null> {
    const permissionGranted = await DesktopNotifications.isPermissionGranted();
    if (!permissionGranted) {
      warn(
        '[NotificationService] The desktop notification provider is, but permission for desktop notifications is not granted.'
      );
      return null;
    }
    DesktopNotifications.sendNotification({
      title,
      body: content,
    });
    return null;
  }

  private async sendOVRToolkitNotification(title: string, content: string): Promise<string | null> {
    // Stop here if the socket is unavailable
    if (!this.ovrtSocket || this.ovrtSocket.readyState !== WebSocket.OPEN) return null;
    // Construct notification
    const notification = {
      title: title,
      body: content,
      icon: APP_ICON_ARR,
    };
    // Construct packet payload
    const packet = {
      messageType: 'SendNotification',
      json: JSON.stringify(notification),
    };
    // Send packet
    this.ovrtSocket.send(JSON.stringify(packet));
    return null;
  }

  private async sendXSOverlayNotification(
    title: string,
    content: string,
    sound: boolean,
    timeout: number
  ): Promise<string | null> {
    const message: XSOMessage = {
      messageType: 1,
      index: 0,
      volume: sound ? 1.0 : 0.0,
      audioPath: sound ? 'default' : '',
      timeout: timeout / 1000,
      title,
      content,
      icon: APP_ICON_B64,
      height: 175,
      opacity: 0,
      useBase64Icon: true,
      sourceApp: 'OyasumiVR/' + (await getVersion()),
    };
    await invoke('xsoverlay_send_message', {
      message: Array.from(new TextEncoder().encode(JSON.stringify(message))),
    });
    return null;
  }

  private async manageOVRTSocketConnection() {
    const buildSocket = () => {
      if (this.ovrtSocket) {
        try {
          this.ovrtSocket.close();
        } catch (e) {
          // Ignore any error, we just want to disconnect
        }
        this.ovrtSocket = undefined;
      }
      this.ovrtSocket = new WebSocket('ws://127.0.0.1:11450/api');
      this.ovrtSocket.onopen = () => this.onOVRTSocketEvent('OPEN');
      this.ovrtSocket.onerror = () => this.onOVRTSocketEvent('ERROR');
      this.ovrtSocket.onclose = () => this.onOVRTSocketEvent('CLOSE');
      this.ovrtSocket.onmessage = (message) => this.onOVRTSocketEvent('MESSAGE', message);
    };
    this.appSettingsService.settings
      .pipe(
        map((settings) => settings.notificationProvider),
        distinctUntilChanged(),
        debounceTime(500)
      )
      .subscribe((provider) => {
        if (provider === 'OVRTOOLKIT') {
          buildSocket();
        } else {
          if (this.ovrtSocket) {
            try {
              this.ovrtSocket.close();
            } catch (e) {
              // Ignore any error, we just want to disconnect
            }
            this.ovrtSocket = undefined;
          }
        }
      });
    // Check connection intermittently in case of dropouts
    interval(10000).subscribe(async () => {
      // Stop if we have an active connection
      if (this.ovrtSocket && this.ovrtSocket.readyState === WebSocket.OPEN) return;
      // Stop if we are not using OVRToolkit as our current provider
      const settings = await firstValueFrom(this.appSettingsService.settings);
      if (settings.notificationProvider !== 'OVRTOOLKIT') return;
      // (Re)build a connection
      buildSocket();
    });
  }

  private async onOVRTSocketEvent(
    event: 'OPEN' | 'CLOSE' | 'ERROR' | 'MESSAGE',
    message?: MessageEvent
  ) {
    switch (event) {
      case 'OPEN':
        info(`[NotificationService] OVRToolkit websocket connection opened`);
        return;
      case 'CLOSE':
        info(`[NotificationService] OVRToolkit websocket connection closed`);
        return;
      case 'ERROR':
        error(
          `[NotificationService] OVRToolkit websocket connection error: ${JSON.stringify(message)}`
        );
        return;
      case 'MESSAGE':
        // Maybe do something with received messages in the future
        break;
    }
  }
}
