import { Directive, ElementRef, HostListener, Input } from '@angular/core';

@Directive({
  selector: 'img[appImgFallback]',
})
export class ImageFallbackDirective {
  @Input() appImgFallback: string = '';

  constructor(private eRef: ElementRef) {}

  @HostListener('error', ['$event'])
  loadFallbackOnError(event: any) {
    console.warn(event);
    const element: HTMLImageElement = <HTMLImageElement>this.eRef.nativeElement;
    element.src = this.appImgFallback || 'https://via.placeholder.com/200';
  }
}
