import { Directive, ElementRef, EventEmitter, HostListener, Output } from '@angular/core';

@Directive({
  selector: '[clickOutside]',
  standalone: false,
})
export class ClickOutsideDirective {
  constructor(private elementRef: ElementRef) {}

  @Output() clickOutside = new EventEmitter<MouseEvent>();

  @HostListener('document:contextmenu', ['$event'])
  @HostListener('document:click', ['$event'])
  public onClick(event: MouseEvent) {
    const clickedInside = event.composedPath().includes(this.elementRef.nativeElement);
    if (!clickedInside) this.clickOutside.emit(event);
  }
}
