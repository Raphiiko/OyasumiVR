import { Directive, ElementRef, HostListener, output } from '@angular/core';

@Directive({
  selector: '[clickOutside]',
  standalone: false,
})
export class ClickOutsideDirective {
  constructor(private elementRef: ElementRef) {}

  readonly clickOutside = output<MouseEvent>();

  @HostListener('document:contextmenu', ['$event'])
  @HostListener('document:click', ['$event'])
  public onClick(event: MouseEvent) {
    const clickedInside = event.composedPath().includes(this.elementRef.nativeElement);
    if (!clickedInside) this.clickOutside.emit(event);
  }
}
