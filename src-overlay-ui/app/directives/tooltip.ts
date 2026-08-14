import { Directive, input } from '@angular/core';

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

  onEnter(): void {
    if (!this.appTooltip()) return;
    this.tooltipShown = true;
    void window.OyasumiIPCOut.showToolTip(this.appTooltip());
  }

  onLeave(): void {
    if (!this.appTooltip() && !this.tooltipShown) return;
    this.tooltipShown = false;
    void window.OyasumiIPCOut.showToolTip(null);
  }
}
