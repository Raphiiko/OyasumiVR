import { AfterViewInit, Directive, ElementRef, OnDestroy } from '@angular/core';

const RESIZE_DURATION = 220;
const EASE_OUT = 'cubic-bezier(0.2, 0.8, 0.25, 1)';

/** Animates a toast slot between its old and new height when the toast's contents change. */
@Directive({
  selector: '[appToastSlot]',
  standalone: false,
})
export class ToastSlotDirective implements AfterViewInit, OnDestroy {
  private observer?: ResizeObserver;
  private height?: number;

  constructor(private elementRef: ElementRef<HTMLElement>) {}

  ngAfterViewInit() {
    const slot = this.elementRef.nativeElement;
    const toast = slot.firstElementChild;
    if (!toast) return;
    this.observer = new ResizeObserver(() => {
      const height = slot.offsetHeight;
      const previousHeight = this.height;
      this.height = height;
      if (previousHeight === undefined || previousHeight === height) return;
      slot.animate([{ height: `${previousHeight}px` }, { height: `${height}px` }], {
        duration: RESIZE_DURATION,
        easing: EASE_OUT,
      });
    });
    this.observer.observe(toast);
  }

  ngOnDestroy() {
    this.observer?.disconnect();
  }
}
