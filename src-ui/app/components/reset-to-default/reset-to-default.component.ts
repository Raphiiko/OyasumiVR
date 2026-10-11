import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { isEqual } from 'lodash';

/** An undo icon that shows while `value` deeply differs from `defaultValue`. */
@Component({
  selector: 'app-reset-to-default',
  templateUrl: './reset-to-default.component.html',
  styleUrls: ['./reset-to-default.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false,
})
export class ResetToDefaultComponent {
  @Input() value?: unknown;
  /** Leave undefined to never show the icon. */
  @Input() defaultValue?: unknown;
  /** Emits a copy of `defaultValue` when the icon is clicked. */
  @Output() resetToDefault = new EventEmitter<any>();

  get canReset(): boolean {
    return this.defaultValue !== undefined && !isEqual(this.value, this.defaultValue);
  }

  reset() {
    this.resetToDefault.emit(structuredClone(this.defaultValue));
  }
}
