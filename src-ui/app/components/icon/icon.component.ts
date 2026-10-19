import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** Draws an icon from `assets/icons`; `svg.svg-icon` does the same inside HTML strings. */
@Component({
  selector: 'app-icon',
  template: "<svg><use [attr.href]=\"'/assets/icons/' + name() + '.svg#icon'\" /></svg>",
  styleUrls: ['./icon.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false,
  host: { '[class.mirrored]': 'mirrored()' },
})
export class IconComponent {
  readonly name = input.required<string>();
  /** Flips the icon horizontally, such as for a right-hand controller. */
  readonly mirrored = input(false);
}
