import { Directive, ElementRef } from '@angular/core';

@Directive({
  selector: 'dialog[appDialogFocus]',
  standalone: true,
  host: { '(keydown)': 'keepFocus($event)' },
})
export class DialogFocusDirective {
  constructor(private element: ElementRef<HTMLDialogElement>) {}

  keepFocus(event: Event) {
    if (!(event instanceof KeyboardEvent) || event.key !== 'Tab') return;
    const controls = [
      ...this.element.nativeElement.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), a[href], [tabindex="0"]'
      ),
    ].filter((element) => element.getClientRects().length > 0);
    const first = controls[0];
    const last = controls.at(-1);
    if (!first || !last) return;
    if (
      event.shiftKey &&
      (document.activeElement === first ||
        !controls.includes(document.activeElement as HTMLElement))
    ) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
}
