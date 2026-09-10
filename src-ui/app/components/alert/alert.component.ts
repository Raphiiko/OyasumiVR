import { ChangeDetectionStrategy, Component, Input } from '@angular/core';

export type AlertSeverity = 'info' | 'success' | 'warning' | 'error';

const SEVERITY_GLYPHS: Record<AlertSeverity, string> = {
  info: 'info',
  success: 'check_circle_outline',
  warning: 'warning',
  error: 'error',
};

/**
 * A bordered notice with a severity colour, a glyph and a body.
 *
 * The severity picks the glyph. Set `icon` to override it, or to an empty string to project a
 * custom one into the icon slot instead.
 */
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
  @Input() icon?: string;
  /** The Material icon font to render the glyph with. */
  @Input() iconClass = 'material-icons';
  /** Extra classes for the content container, for example `flex-row`. */
  @Input() contentClass?: string;

  get glyph(): string {
    return this.icon ?? SEVERITY_GLYPHS[this.severity];
  }
}
