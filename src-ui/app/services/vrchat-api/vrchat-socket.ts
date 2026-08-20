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
const HEALTHY_CONNECTION_DURATION = 30_000;
const FAILURE_REPORT_THRESHOLD = 3;

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
  private openedAt?: number;
  private socketError = false;
  private consecutiveFailures = 0;
  /** Changes whenever pending socket work must be discarded. */
  private connectionGeneration = 0;

  public readonly status = this.statusSubject.asObservable();
  public readonly notifications = this.notificationSubject.asObservable();

  constructor(
    private readonly auth: VRChatAuth,
    private readonly api: VRChatAPI,
    private readonly settings: Observable<VRChatApiSettings>,
    private readonly reportError: (cause: Error) => void
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
        this.consecutiveFailures = 0;
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
    this.openedAt = undefined;
    this.socketError = false;
    socket.onopen = () => this.handleOpen(socket);
    socket.onerror = () => this.handleError(socket);
    socket.onclose = (event) => this.handleClose(socket, event);
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
    this.openedAt = Date.now();
    this.statusSubject.next('OPEN');
    info('[VRChat] Websocket connection opened');
  }

  private handleClose(socket: WebSocket, event: CloseEvent): void {
    if (this.socket !== socket) return;
    const lifetime = this.openedAt === undefined ? undefined : Date.now() - this.openedAt;
    const failedBeforeHealthy = lifetime === undefined || lifetime < HEALTHY_CONNECTION_DURATION;
    this.consecutiveFailures = failedBeforeHealthy ? this.consecutiveFailures + 1 : 0;
    this.socket = undefined;
    this.statusSubject.next('CLOSED');
    const reason = event.reason.trim().replace(/\s+/g, ' ').slice(0, 120) || 'none';
    const lifetimeBucket = socketLifetimeBucket(lifetime);
    info(
      `[VRChat] Websocket connection closed: code=${event.code} clean=${event.wasClean} lifetime=${lifetimeBucket} error=${this.socketError} reason=${reason}`
    );
    if (this.consecutiveFailures === FAILURE_REPORT_THRESHOLD) {
      this.reportError(
        new Error(
          `VRChat pipeline repeatedly closed: code=${event.code} clean=${event.wasClean} lifetime=${lifetimeBucket} error=${this.socketError} reason=${reason}`
        )
      );
    }
  }

  private handleError(socket: WebSocket): void {
    if (this.socket !== socket) return;
    this.socketError = true;
    error('[VRChat] Websocket connection error');
  }

  private handleMessage(socket: WebSocket, message: MessageEvent): void {
    if (this.socket !== socket) return;

    let data: VRChatPipelineMessage;
    try {
      data = JSON.parse(String(message.data)) as VRChatPipelineMessage;
    } catch (cause) {
      error(`[VRChat] Failed to parse websocket message: ${cause}`);
      this.reportError(new Error('VRChat pipeline message parsing failed'));
      return;
    }

    const handler = this.handlers.find((candidate) => candidate.type === data.type);
    if (!handler) return;
    try {
      void Promise.resolve(handler.handle(data.content)).catch((cause) =>
        this.reportHandlerError(data.type, cause)
      );
    } catch (cause) {
      this.reportHandlerError(data.type, cause);
    }
  }

  private reportHandlerError(type: string, cause: unknown): void {
    error(`[VRChat] Failed to handle websocket event '${type}': ${cause}`);
    this.reportError(new Error(`VRChat pipeline event handling failed: ${type}`));
  }

  private async receiveNotification(notification: Notification): Promise<void> {
    info(`[VRChat] Received notification: ${JSON.stringify(notification)}`);
    this.notificationSubject.next(notification);
  }
}

function socketLifetimeBucket(lifetime: number | undefined): string {
  if (lifetime === undefined) return 'not-opened';
  if (lifetime < 1_000) return 'under-1s';
  if (lifetime < 10_000) return 'under-10s';
  if (lifetime < HEALTHY_CONNECTION_DURATION) return 'under-30s';
  return 'healthy';
}
