import { Directive, ElementRef, HostListener, Input } from '@angular/core';

@Directive({
    selector: 'img[appImgFallback]',
    standalone: false
})
export class ImageFallbackDirective {
  @Input() appImgFallback = '';

  constructor(private eRef: ElementRef) {}

  @HostListener('error', ['$event'])
  loadFallbackOnError(event: any) {
    console.warn(event);
    const element: HTMLImageElement = <HTMLImageElement>this.eRef.nativeElement;
    element.src = this.appImgFallback || 'https://via.placeholder.com/200';
  }
}
