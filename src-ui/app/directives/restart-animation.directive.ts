import { Directive, ElementRef, Input, OnChanges, SimpleChanges } from '@angular/core';

/** Restarts the element's CSS animation whenever the bound value changes. */
@Directive({
  selector: '[restartAnimationOn]',
  standalone: false,
})
export class RestartAnimationDirective implements OnChanges {
  @Input() restartAnimationOn: unknown;

  constructor(private elementRef: ElementRef<HTMLElement>) {}

  ngOnChanges(changes: SimpleChanges) {
    if (changes['restartAnimationOn'].firstChange) return;
    const element = this.elementRef.nativeElement;
    element.style.animation = 'none';
    // reading the layout forces a reflow, without which the animation never restarts
    void element.offsetHeight;
    element.style.animation = '';
  }
}
