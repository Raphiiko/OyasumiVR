import { animate, group, sequence, style, transition, trigger } from '@angular/animations';
import { ChangeDetectionStrategy, Component } from '@angular/core';
import {
  Toast,
  ToastAction,
  ToastRef,
  ToastService,
  ToastType,
} from '../../services/toast.service';

const EASE_OUT = 'cubic-bezier(0.2, 0.8, 0.25, 1)';

const ICONS: Record<Exclude<ToastType, 'pending'>, string> = {
  info: 'info',
  success: 'check_circle',
  warning: 'warning',
  error: 'error',
};

@Component({
  selector: 'app-toasts',
  templateUrl: './toasts.component.html',
  styleUrls: ['./toasts.component.scss'],
  standalone: false,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { role: 'status', 'aria-live': 'polite' },
  animations: [
    trigger('toastSlot', [
      transition(':enter', [
        style({ height: 0, opacity: 0, transform: 'scale(0.98)' }),
        group([
          animate(`240ms ${EASE_OUT}`, style({ height: '*' })),
          animate(`240ms ${EASE_OUT}`, style({ opacity: 1, transform: 'none' })),
        ]),
      ]),
      transition(':leave', [
        sequence([
          animate('200ms ease-in', style({ opacity: 0, transform: 'scale(0.98)' })),
          animate(`220ms ${EASE_OUT}`, style({ height: 0 })),
        ]),
      ]),
    ]),
  ],
})
export class ToastsComponent {
  protected readonly toasts = this.toastService.toasts;

  constructor(private toastService: ToastService) {}

  protected iconFor(type: ToastType): string {
    return ICONS[type as Exclude<ToastType, 'pending'>] ?? ICONS.info;
  }

  protected dismiss(toast: Toast) {
    this.toastService.dismiss(toast.id);
  }

  protected runAction(toast: Toast, action: ToastAction) {
    action.action(new ToastRef(toast.id, this.toastService));
  }
}
