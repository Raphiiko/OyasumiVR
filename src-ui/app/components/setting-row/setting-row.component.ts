import { ChangeDetectionStrategy, Component, Input } from '@angular/core';

/**
 * `label` and `description` accept translation keys; their Text variants accept rendered text.
 * Project markup into [rowLabel] and [rowDescription]; other content becomes the action.
 */
@Component({
  selector: 'app-setting-row',
  templateUrl: './setting-row.component.html',
  host: { class: 'setting-row' },
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false,
})
export class SettingRowComponent {
  @Input() label?: string;
  @Input() description?: string;
  @Input() labelText?: string;
  @Input() descriptionText?: string;
  /** Renders the warning glyph and bold title used for conflicting settings. */
  @Input() conflict = false;
  @Input() actionClass?: string;
}
