import { Component, input, output } from '@angular/core';

/**
 * `label` and `description` accept translation keys; their Text variants accept rendered text.
 * Project markup into [rowLabel] and [rowDescription]; other content becomes the action.
 */
@Component({
  selector: 'app-setting-row',
  templateUrl: './setting-row.component.html',
  host: { class: 'setting-row' },
  standalone: false,
})
export class SettingRowComponent {
  readonly label = input<string>();
  readonly description = input<string>();
  readonly labelText = input<string>();
  readonly descriptionText = input<string>();
  /** Renders the warning icon and bold title used for conflicting settings. */
  readonly conflict = input(false);
  readonly actionClass = input<string>();
  /** Passed to the reset icon beside the title; see ResetToDefaultComponent. */
  readonly value = input<unknown>();
  readonly defaultValue = input<unknown>();
  readonly resetToDefault = output<any>();
}
