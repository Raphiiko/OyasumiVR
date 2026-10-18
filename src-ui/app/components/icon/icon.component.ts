import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** Draws an icon from `assets/icons`; `svg.svg-icon` does the same inside HTML strings. */
@Component({
  selector: 'app-icon',
  template: "<svg><use [attr.href]=\"'/assets/icons/' + name() + '.svg#icon'\" /></svg>",
  styleUrls: ['./icon.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false,
})
export class IconComponent {
  readonly name = input.required<string>();
}
