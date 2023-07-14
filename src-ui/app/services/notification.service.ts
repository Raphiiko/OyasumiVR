import { Injectable } from '@angular/core';
import { getVersion } from '../utils/app-utils';
import { invoke } from '@tauri-apps/api';
import * as DesktopNotifications from '@tauri-apps/api/notification';
import { AppSettingsService } from './app-settings.service';
import { firstValueFrom, map } from 'rxjs';
import { APP_ICON_B64 } from '../globals';
import { NotificationProvider, NotificationType } from '../models/settings';
import { warn } from 'tauri-plugin-log-api';
import { IPCService } from './ipc.service';

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
  constructor(private appSettingsService: AppSettingsService, private ipcService: IPCService) {}

  public async play_sound(sound: 'bell' | 'block') {
    await invoke('play_sound', {
      name: 'notification_' + sound,
    });
  }

  public async send(content: string, duration = 3000): Promise<string | null> {
    try {
      const settings = await firstValueFrom(this.appSettingsService.settings);
      switch (settings.notificationProvider) {
        case 'OYASUMIVR':
          return await this.sendOyasumiNotification(content, duration);
        case 'XSOVERLAY':
          return await this.sendXSOverlayNotification('OyasumiVR', content, false, duration / 1000);
        case 'DESKTOP':
          return await this.sendDesktopNotification('OyasumiVR', content);
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
    await invoke('clear_notification', { notificationId });
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
}
