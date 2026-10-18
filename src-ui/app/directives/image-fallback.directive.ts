import { Directive, ElementRef, HostListener, input } from '@angular/core';

@Directive({
  selector: 'img[appImgFallback]',
  standalone: false,
})
export class ImageFallbackDirective {
  readonly appImgFallback = input('');

  constructor(private eRef: ElementRef) {}

  @HostListener('error')
  loadFallbackOnError() {
    const element: HTMLImageElement = <HTMLImageElement>this.eRef.nativeElement;
    element.src = this.appImgFallback() || 'https://via.placeholder.com/200';
  }
}
