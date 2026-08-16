import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Notification } from '../../components/notification/notification';
import { IpcService } from '../../ipc/ipc.service';
import { AddNotificationParams } from '../../ipc/oyasumi-ipc';

@Component({
  selector: 'app-notifications-overlay',
  imports: [Notification],
  templateUrl: './notifications-overlay.html',
  styleUrl: './notifications-overlay.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NotificationsOverlay {
  private readonly ipc = inject(IpcService);

  private readonly notifications = signal<AddNotificationParams[]>([]);
  private readonly activeNotification = signal<AddNotificationParams | null>(null);
  private dismissTimer?: ReturnType<typeof setTimeout>;

  protected readonly shownNotifications = computed(() =>
    this.notifications().slice(0, 3).reverse()
  );

  constructor() {
    this.ipc.notificationAdded.pipe(takeUntilDestroyed()).subscribe((notification) => {
      this.notifications.update((notifications) => [...notifications, notification]);
      this.updateActiveNotification();
    });
    this.ipc.notificationCleared.pipe(takeUntilDestroyed()).subscribe((id) => {
      this.notifications.update((notifications) => notifications.filter((n) => n.id !== id));
      this.updateActiveNotification();
    });
    inject(DestroyRef).onDestroy(() => clearTimeout(this.dismissTimer));
  }

  protected isActive(notification: AddNotificationParams): boolean {
    return notification === this.activeNotification();
  }

  private updateActiveNotification(): void {
    const next = this.notifications()[0] ?? null;
    if (next === this.activeNotification()) return;
    this.activeNotification.set(next);
    clearTimeout(this.dismissTimer);
    if (!next?.id) return;
    const id = next.id;
    this.dismissTimer = setTimeout(() => this.ipc.notificationCleared.next(id), next.duration);
  }
}
