import { DestroyRef, Directive, inject, input } from '@angular/core';

/** Raises a tooltip on the sidecar's tooltip overlay while the host is hovered. */
@Directive({
  selector: '[appTooltip]',
  host: {
    '(mouseenter)': 'onEnter()',
    '(mouseleave)': 'onLeave()',
  },
})
export class Tooltip {
  readonly appTooltip = input('');

  private tooltipShown = false;

  constructor() {
    // A hovered host can be removed by its own click, which never raises mouseleave.
    inject(DestroyRef).onDestroy(() => this.onLeave());
  }

  onEnter(): void {
    if (!this.appTooltip()) return;
    this.tooltipShown = true;
    void window.OyasumiIPCOut.showToolTip(this.appTooltip());
  }

  onLeave(): void {
    if (!this.tooltipShown) return;
    this.tooltipShown = false;
    void window.OyasumiIPCOut.showToolTip(null);
  }
}
