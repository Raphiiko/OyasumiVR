import { firstValueFrom } from 'rxjs';
import { describe, expect, it } from 'vitest';
import { Toast, ToastService } from './toast.service';

async function current(service: ToastService): Promise<Toast[]> {
  return firstValueFrom(service.toasts);
}

describe('ToastService', () => {
  it('applies defaults and keeps several toasts at once', async () => {
    const service = new ToastService();
    service.show({ title: 'first' });
    service.show({ title: 'second', type: 'warning', duration: 10000, dismissable: false });
    const toasts = await current(service);
    expect(toasts.map((toast) => toast.title)).toEqual(['first', 'second']);
    expect(toasts[0]).toMatchObject({
      type: 'info',
      duration: 4000,
      dismissable: true,
      pauseOnHover: true,
      autoDismiss: true,
      actions: [],
    });
    expect(toasts[1]).toMatchObject({ type: 'warning', duration: 10000, dismissable: false });
  });

  it('keeps the defaults when a caller passes an undefined option', async () => {
    const service = new ToastService();
    service.show({
      title: 'first',
      duration: undefined,
      dismissable: undefined,
      pauseOnHover: undefined,
    });
    const [toast] = await current(service);
    expect(toast).toMatchObject({ duration: 4000, dismissable: true, pauseOnHover: true });
  });

  it('keeps unchanged fields on update', async () => {
    const service = new ToastService();
    const ref = service.show({ title: 'first', type: 'warning', duration: 10000 });
    ref.update({ title: 'second' });
    ref.update({ title: undefined, type: 'error', autoDismiss: false });
    ref.update({ autoDismiss: undefined });
    const [toast] = await current(service);
    expect(toast).toMatchObject({
      title: 'second',
      type: 'error',
      duration: 10000,
      autoDismiss: false,
    });
  });

  it('updates a toast in place and bumps its revision', async () => {
    const service = new ToastService();
    const ref = service.show({ title: 'quitting', type: 'warning', duration: 10000 });
    ref.update({ title: 'cancelled', type: 'success', duration: 4000 });
    const [toast] = await current(service);
    expect(toast).toMatchObject({
      title: 'cancelled',
      type: 'success',
      duration: 4000,
      revision: 1,
    });
  });

  it('dismisses only its own toast, and ignores calls after dismissal', async () => {
    const service = new ToastService();
    const first = service.show({ title: 'first' });
    service.show({ title: 'second' });
    first.dismiss();
    first.update({ title: 'ignored' });
    const toasts = await current(service);
    expect(toasts.map((toast) => toast.title)).toEqual(['second']);
  });
});
