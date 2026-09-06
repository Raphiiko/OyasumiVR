import '@angular/compiler';
import { DestroyRef, Injector, runInInjectionContext } from '@angular/core';
import { Subject } from 'rxjs';
import { afterEach, expect, it, vi } from 'vitest';
import { IpcService } from '../../ipc/ipc.service';
import { NotificationsOverlay } from './notifications-overlay';

vi.mock('../../ipc/ipc.service', () => ({ IpcService: class {} }));
vi.mock('../../components/notification/notification', () => ({ Notification: class {} }));

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('subscribes before readiness and dismisses accepted notifications by ID', () => {
  vi.useFakeTimers();
  const notificationAdded = new Subject<{ id: string; message: string; duration: number }>();
  const notificationCleared = new Subject<string>();
  const cleanup: Array<() => void> = [];
  const injector = Injector.create({
    providers: [
      { provide: IpcService, useValue: { notificationAdded, notificationCleared } },
      { provide: DestroyRef, useValue: { onDestroy: (fn: () => void) => cleanup.push(fn) } },
    ],
  });
  const onUiReady = vi.fn(() => {
    expect(notificationAdded.observed).toBe(true);
    expect(notificationCleared.observed).toBe(true);
    notificationAdded.next({ id: 'accepted', message: 'test', duration: 3000 });
    return Promise.resolve();
  });
  vi.stubGlobal('window', { OyasumiIPCOut: { onUiReady } });
  class TestOverlay extends NotificationsOverlay {
    get shown() {
      return this.shownNotifications();
    }
  }

  notificationAdded.next({ id: 'early', message: 'early', duration: 3000 });
  const overlay = runInInjectionContext(injector, () => new TestOverlay());
  expect(onUiReady).not.toHaveBeenCalled();
  overlay.ngOnInit();
  expect(overlay.shown.map((n) => n.id)).toEqual(['accepted']);
  notificationCleared.next('accepted');
  expect(overlay.shown).toEqual([]);

  notificationAdded.next({ id: 'timed', message: 'timed', duration: 3000 });
  vi.advanceTimersByTime(3000);
  expect(overlay.shown).toEqual([]);
  cleanup.forEach((fn) => fn());
});
