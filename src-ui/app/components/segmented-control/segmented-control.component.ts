import { ChangeDetectionStrategy, Component, input, model } from '@angular/core';

export interface SegmentedControlItem<T extends string = string> {
  id: T;
  /** A translation key. */
  label: string;
}

@Component({
  selector: 'app-segmented-control',
  templateUrl: './segmented-control.component.html',
  styleUrls: ['./segmented-control.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false,
})
export class SegmentedControlComponent<T extends string = string> {
  readonly items = input.required<SegmentedControlItem<T>[]>();
  /** A translation key that names the choice for screen readers. */
  readonly label = input.required<string>();
  readonly selected = model.required<T>();
}
