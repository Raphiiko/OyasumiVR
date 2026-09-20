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
  private animation?: Animation;
  private height?: number;

  constructor(private elementRef: ElementRef<HTMLElement>) {}

  ngAfterViewInit() {
    const slot = this.elementRef.nativeElement;
    const toast = slot.firstElementChild as HTMLElement | null;
    if (!toast) return;
    this.observer = new ResizeObserver(() => {
      // the enter and leave animations own the slot's height, so measure the toast itself
      const height = toast.offsetHeight + parseFloat(getComputedStyle(toast).marginTop);
      const previousHeight = this.height;
      this.height = height;
      if (previousHeight === undefined || previousHeight === height) return;
      // an interrupted resize continues from what the slot shows, not from where it was headed
      const from = this.animation?.playState === 'running' ? slot.offsetHeight : previousHeight;
      this.animation?.cancel();
      this.animation = slot.animate([{ height: `${from}px` }, { height: `${height}px` }], {
        duration: RESIZE_DURATION,
        easing: EASE_OUT,
      });
    });
    this.observer.observe(toast);
  }

  ngOnDestroy() {
    this.observer?.disconnect();
    this.animation?.cancel();
  }
}
