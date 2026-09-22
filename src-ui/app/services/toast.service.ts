import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { TString } from '../models/translatable-string';

export type ToastType = 'info' | 'success' | 'warning' | 'error' | 'pending';

export interface ToastAction {
  label: TString;
  action: (toast: ToastRef) => void;
}

export interface ToastOptions {
  type?: ToastType;
  title: TString;
  message?: TString;
  /** Milliseconds before the toast dismisses itself. 0 keeps it up until it is dismissed in code. */
  duration?: number;
  /** When false, the toast has no close button. It still dismisses on its duration. */
  dismissable?: boolean;
  /** Defaults to true. */
  pauseOnHover?: boolean;
  /** Defaults to true. When false, the duration only drives the progress bar. */
  autoDismiss?: boolean;
  actions?: ToastAction[];
}

export interface Toast extends ToastOptions {
  id: string;
  type: ToastType;
  duration: number;
  dismissable: boolean;
  pauseOnHover: boolean;
  autoDismiss: boolean;
  actions: ToastAction[];
  /** Bumped on every update, so the view restarts the duration animation. */
  revision: number;
}

/** Handle to a shown toast. Calls on an already dismissed toast do nothing. */
export class ToastRef {
  constructor(
    public readonly id: string,
    private readonly service: ToastService
  ) {}

  update(options: Partial<ToastOptions>) {
    this.service.update(this.id, options);
  }

  dismiss() {
    this.service.dismiss(this.id);
  }
}

@Injectable({
  providedIn: 'root',
})
export class ToastService {
  private readonly _toasts = new BehaviorSubject<Toast[]>([]);
  public readonly toasts = this._toasts.asObservable();

  private nextId = 0;

  show(options: ToastOptions): ToastRef {
    const toast: Toast = {
      ...options,
      type: options.type ?? 'info',
      duration: options.duration ?? 4000,
      dismissable: options.dismissable ?? true,
      pauseOnHover: options.pauseOnHover ?? true,
      autoDismiss: options.autoDismiss ?? true,
      actions: options.actions ?? [],
      id: `toast-${this.nextId++}`,
      revision: 0,
    };
    this._toasts.next([...this._toasts.value, toast]);
    return new ToastRef(toast.id, this);
  }

  update(id: string, options: Partial<ToastOptions>) {
    this._toasts.next(
      this._toasts.value.map((toast) => {
        if (toast.id !== id) return toast;
        return {
          ...toast,
          ...options,
          title: options.title ?? toast.title,
          type: options.type ?? toast.type,
          duration: options.duration ?? toast.duration,
          dismissable: options.dismissable ?? toast.dismissable,
          pauseOnHover: options.pauseOnHover ?? toast.pauseOnHover,
          autoDismiss: options.autoDismiss ?? toast.autoDismiss,
          actions: options.actions ?? toast.actions,
          revision: toast.revision + 1,
        };
      })
    );
  }

  dismiss(id: string) {
    this._toasts.next(this._toasts.value.filter((toast) => toast.id !== id));
  }

  dismissAll() {
    this._toasts.next([]);
  }
}
