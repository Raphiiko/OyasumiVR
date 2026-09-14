import { ChangeDetectionStrategy, Component, Input } from '@angular/core';

/**
 * A single row inside a `.settings` group: a title, an optional description, and an action.
 *
 * Pass `label` and `description` as translation keys, or `labelText` and `descriptionText` for
 * values that are already rendered. For markup that neither covers, project into the `rowLabel`
 * and `rowDescription` slots. Everything left over is projected into the action.
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
  /** Extra classes for the action container, for example `command-input`. */
  @Input() actionClass?: string;
}
