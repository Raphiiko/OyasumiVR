import { Component, computed, input, output } from '@angular/core';
import { isEqual } from 'lodash';

/** An undo icon that shows while `value` deeply differs from `defaultValue`. */
@Component({
  selector: 'app-reset-to-default',
  templateUrl: './reset-to-default.component.html',
  styleUrls: ['./reset-to-default.component.scss'],
  standalone: false,
})
export class ResetToDefaultComponent {
  readonly value = input<unknown>();
  /** Leave undefined to never show the icon. */
  readonly defaultValue = input<unknown>();
  /** Emits a copy of `defaultValue` when the icon is clicked. */
  readonly resetToDefault = output<any>();

  protected readonly canReset = computed(
    () => this.defaultValue() !== undefined && !isEqual(this.value(), this.defaultValue())
  );

  protected reset() {
    this.resetToDefault.emit(structuredClone(this.defaultValue()));
  }
}
