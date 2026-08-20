import { error, info } from '@tauri-apps/plugin-log';
import type { Notification } from 'vrchat';
import {
  BehaviorSubject,
  distinctUntilChanged,
  filter,
  firstValueFrom,
  interval,
  Observable,
  Subject,
  switchMap,
  take,
} from 'rxjs';
import { VRChatApiSettings } from 'src-ui/app/models/vrchat-api-settings';
import { GroupMemberUpdatedHandler } from './event-handlers/group-member-updated-handler';
import { NotificationHandler } from './event-handlers/notification-handler';
import { UserUpdateHandler } from './event-handlers/user-update-handler';
import { VRChatAPI } from './vrchat-api';
import { VRChatAuth } from './vrchat-auth';

const RECONNECT_INTERVAL = 10_000;

export type VRChatSocketStatus = 'CLOSED' | 'OPEN' | 'OPENING';

export interface VRChatEventHandler {
  type: string;
  handle: (content: string) => void | Promise<void>;
}

interface VRChatPipelineMessage {
  type: string;
  content: string;
}

export class VRChatSocket {
  private readonly statusSubject = new BehaviorSubject<VRChatSocketStatus>('CLOSED');
  private readonly notificationSubject = new Subject<Notification>();
  private readonly handlers: VRChatEventHandler[];
  private socket?: WebSocket;
  /** Changes whenever pending socket work must be discarded. */
  private connectionGeneration = 0;

  public readonly status = this.statusSubject.asObservable();
  public readonly notifications = this.notificationSubject.asObservable();

  constructor(
    private readonly auth: VRChatAuth,
    private readonly api: VRChatAPI,
    private readonly settings: Observable<VRChatApiSettings>
  ) {
    this.handlers = [
      new UserUpdateHandler(this.auth),
      new NotificationHandler(this.receiveNotification.bind(this)),
      new GroupMemberUpdatedHandler(this.api),
    ];
  }

  public init(): void {
    this.auth.status.pipe(distinctUntilChanged()).subscribe((status) => {
      if (status === 'LOGGED_IN') {
        void this.openSocket();
      } else if (status === 'LOGGED_OUT') {
        this.closeSocket();
      }
    });

    interval(RECONNECT_INTERVAL)
      .pipe(
        switchMap(() => this.auth.status.pipe(take(1))),
        filter((status) => status === 'LOGGED_IN' && !this.hasActiveSocket())
      )
      .subscribe(() => void this.openSocket());
  }

  private hasActiveSocket(): boolean {
    return (
      this.socket?.readyState === WebSocket.CONNECTING || this.socket?.readyState === WebSocket.OPEN
    );
  }

  private async openSocket(): Promise<void> {
    if (this.hasActiveSocket() || this.statusSubject.value === 'OPENING') return;

    this.closeSocket();
    const connectionGeneration = this.connectionGeneration;
    this.statusSubject.next('OPENING');
    const authToken = (await firstValueFrom(this.settings)).authCookie;
    if (connectionGeneration !== this.connectionGeneration) return;
    if (!authToken) {
      this.statusSubject.next('CLOSED');
      return;
    }

    info('[VRChat] Opening new socket connection');
    let socket: WebSocket;
    try {
      socket = new WebSocket(
        `wss://pipeline.vrchat.cloud/?authToken=${encodeURIComponent(authToken)}`
      );
    } catch (cause) {
      this.statusSubject.next('CLOSED');
      error(`[VRChat] Failed to open websocket connection: ${cause}`);
      return;
    }
    this.socket = socket;
    socket.onopen = () => this.handleOpen(socket);
    socket.onerror = () => this.handleError(socket);
    socket.onclose = () => this.handleClose(socket);
    socket.onmessage = (message) => this.handleMessage(socket, message);
  }

  private closeSocket(): void {
    this.connectionGeneration++;
    const socket = this.socket;
    this.socket = undefined;
    this.statusSubject.next('CLOSED');
    if (!socket) return;

    info('[VRChat] Closing existing socket connection');
    try {
      socket.close();
    } catch {}
  }

  private handleOpen(socket: WebSocket): void {
    if (this.socket !== socket) return;
    this.statusSubject.next('OPEN');
    info('[VRChat] Websocket connection opened');
  }

  private handleClose(socket: WebSocket): void {
    if (this.socket !== socket) return;
    this.socket = undefined;
    this.statusSubject.next('CLOSED');
    info('[VRChat] Websocket connection closed');
  }

  private handleError(socket: WebSocket): void {
    if (this.socket !== socket) return;
    error('[VRChat] Websocket connection error');
    this.closeSocket();
  }

  private handleMessage(socket: WebSocket, message: MessageEvent): void {
    if (this.socket !== socket) return;

    let data: VRChatPipelineMessage;
    try {
      data = JSON.parse(String(message.data)) as VRChatPipelineMessage;
    } catch (cause) {
      error(`[VRChat] Failed to parse websocket message: ${cause}`);
      return;
    }

    const handler = this.handlers.find((candidate) => candidate.type === data.type);
    if (!handler) return;
    try {
      void Promise.resolve(handler.handle(data.content)).catch((cause) =>
        error(`[VRChat] Failed to handle websocket event '${data.type}': ${cause}`)
      );
    } catch (cause) {
      error(`[VRChat] Failed to handle websocket event '${data.type}': ${cause}`);
    }
  }

  private async receiveNotification(notification: Notification): Promise<void> {
    info(`[VRChat] Received notification: ${JSON.stringify(notification)}`);
    this.notificationSubject.next(notification);
  }
}
