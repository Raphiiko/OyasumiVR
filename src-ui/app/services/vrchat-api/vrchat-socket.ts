import { error, info } from '@tauri-apps/plugin-log';
import {
  distinctUntilChanged,
  filter,
  firstValueFrom,
  interval,
  Observable,
  Subject,
  switchMap,
  take,
} from 'rxjs';
import { UserUpdateHandler } from './event-handlers/user-update-handler';
import { NotificationHandler } from './event-handlers/notification-handler';
import type { Notification } from 'vrchat/dist';
import { VRChatAuth } from './vrchat-auth';
import { VRChatApiSettings } from 'src-ui/app/models/vrchat-api-settings';
import { GroupMemberUpdatedHandler } from './event-handlers/group-member-updated-handler';
import { VRChatAPI } from './vrchat-api';

export interface VRChatEventHandler {
  type: string;
  handle: (content: string) => void;
}

export class VRChatSocket {
  private socket?: WebSocket;
  private handlers: VRChatEventHandler[] = [];
  private _notifications: Subject<Notification> = new Subject<Notification>();
  public readonly notifications = this._notifications.asObservable();

  constructor(
    private vrchatAuth: VRChatAuth,
    private vrchatApi: VRChatAPI,
    private settings: Observable<VRChatApiSettings>
  ) {
    this.handlers = [
      new UserUpdateHandler(this.vrchatAuth),
      new NotificationHandler(this.onVRChatNotification.bind(this)),
      new GroupMemberUpdatedHandler(this.vrchatApi),
    ];
  }

  //
  // Initialization
  //

  public async init() {
    const buildSocket = async () => {
      if (this.socket) {
        try {
          this.socket.close();
        } catch (e) {
          // Ignore any error, we just want to disconnect
        }
        this.socket = undefined;
      }
      this.socket = new WebSocket(
        'wss://pipeline.vrchat.cloud/?authToken=' + (await firstValueFrom(this.settings)).authCookie
      );
      this.socket.onopen = () => this.onSocketEvent('OPEN');
      this.socket.onerror = () => this.onSocketEvent('ERROR');
      this.socket.onclose = () => this.onSocketEvent('CLOSE');
      this.socket.onmessage = (message) => this.onSocketEvent('MESSAGE', message);
    };
    // Connect and disconnect based on login status
    this.vrchatAuth.status.pipe(distinctUntilChanged()).subscribe((status) => {
      switch (status) {
        case 'LOGGED_OUT':
          if (this.socket) {
            try {
              this.socket.close();
            } catch (e) {
              // Ignore any error, we just want to disconnect
            }
            this.socket = undefined;
          }
          break;
        case 'LOGGED_IN':
          buildSocket();
          break;
      }
    });
    // Check connection intermittently in case of dropouts
    interval(10000)
      .pipe(
        switchMap(() => this.vrchatAuth.status),
        take(1),
        filter((status) => status === 'LOGGED_IN')
      )
      .subscribe(() => {
        // Stop if we have an active connection
        if (this.socket && this.socket.readyState === WebSocket.OPEN) return;
        // (Re)build a connection
        buildSocket();
      });
  }

  //
  // Event Handling
  //

  private async onSocketEvent(
    event: 'OPEN' | 'CLOSE' | 'ERROR' | 'MESSAGE',
    message?: MessageEvent
  ) {
    switch (event) {
      case 'OPEN':
        info(`[VRChat] Websocket connection opened`);
        return;
      case 'CLOSE':
        info(`[VRChat] Websocket connection closed`);
        return;
      case 'ERROR':
        error(`[VRChat] Websocket connection error: ${JSON.stringify(message)}`);
        return;
      case 'MESSAGE':
        break;
    }
    if (event !== 'MESSAGE') return;
    const data = JSON.parse(message?.data as string);
    const handler = this.handlers.find((handler) => handler.type === data.type);
    if (!handler) return;
    info(`[VRChat] Received event: ${data.type}`);
    // info(`[VRChat] Received event: ${data.type}`);
    handler.handle(data.content);
  }

  public async onVRChatNotification(notification: Notification) {
    info(`[VRChat] Received notification: ${JSON.stringify(notification)}`);
    this._notifications.next(notification);
  }
}
