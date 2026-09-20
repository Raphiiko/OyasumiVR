import { Directive, ElementRef, Input, OnChanges, SimpleChanges } from '@angular/core';

/**
 * Plays the element's CSS animation again from the start whenever the bound value changes.
 *
 * Angular reuses an element across a data change, so a CSS animation on it keeps running from
 * wherever it was. Bind a value that changes per run to replay the animation instead:
 *
 * ```html
 * <div class="toast-duration" [style.animation-duration.ms]="toast.duration"
 *      [restartAnimationOn]="toast.revision"></div>
 * ```
 *
 * The first change after creation is ignored, so the initial render plays the animation once.
 * Only `animation-name` is touched, which leaves every other animation property, including one an
 * Angular style binding owns, in place.
 */
@Directive({
  selector: '[restartAnimationOn]',
  standalone: false,
})
export class RestartAnimationDirective implements OnChanges {
  /** Any value that changes when the animation should play again. Its type does not matter. */
  @Input() restartAnimationOn: unknown;

  constructor(private elementRef: ElementRef<HTMLElement>) {}

  ngOnChanges(changes: SimpleChanges) {
    if (changes['restartAnimationOn'].firstChange) return;
    const element = this.elementRef.nativeElement;
    element.style.animationName = 'none';
    // reading the layout forces a reflow, without which the animation never restarts
    void element.offsetHeight;
    element.style.animationName = '';
  }
}
