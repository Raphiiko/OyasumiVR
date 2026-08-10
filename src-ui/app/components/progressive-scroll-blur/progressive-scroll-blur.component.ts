import { Component, input, ChangeDetectionStrategy } from '@angular/core';

@Component({
  selector: 'app-progressive-scroll-blur',
  standalone: false,
  templateUrl: './progressive-scroll-blur.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './progressive-scroll-blur.component.scss',
})
export class ProgressiveScrollBlurComponent {
  public readonly topSize = input<number>(15);
  public readonly bottomSize = input<number>(15);
}
