import { ChangeDetectionStrategy, Component, Input } from '@angular/core';

export type AlertSeverity = 'info' | 'success' | 'warning' | 'error';

const SEVERITY_ICONS: Record<AlertSeverity, string> = {
  info: 'info',
  success: 'check-circle',
  warning: 'warning',
  error: 'exclamation-circle',
};

@Component({
  selector: 'app-alert',
  templateUrl: './alert.component.html',
  host: { class: 'alert', '[class]': 'severity' },
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false,
})
export class AlertComponent {
  @Input() severity: AlertSeverity = 'info';
  /** Translation key for the body. Project content instead when the body is markup. */
  @Input() message?: string;
  /** Icon name; defaults to the severity icon, and an empty string leaves only projected [alertIcon] content. */
  @Input() icon?: string;
  @Input() contentClass?: string;

  get iconName(): string {
    return this.icon ?? SEVERITY_ICONS[this.severity];
  }

  get iconColor(): string {
    return `var(--color-alert-${this.severity})`;
  }
}
