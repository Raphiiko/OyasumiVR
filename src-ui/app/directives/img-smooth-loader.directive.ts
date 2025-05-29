import {
  Directive,
  ElementRef,
  HostListener,
  Input,
  OnChanges,
  Renderer2,
  SimpleChanges,
} from '@angular/core';

@Directive({
  // eslint-disable-next-line @angular-eslint/directive-selector
  selector: '[imgSmoothLoader]',
  standalone: false,
})
export class ImgSmoothLoaderDirective implements OnChanges {
  @Input('imgSmoothLoader') imageUrl?: string | null;

  constructor(
    private elementRef: ElementRef,
    private renderer: Renderer2
  ) {}

  ngOnChanges(changes: SimpleChanges) {
    if (changes['imageUrl']?.previousValue !== changes['imageUrl']?.currentValue) {
      if (!this.imageUrl) return;
      this.renderer.setAttribute(this.elementRef.nativeElement, 'src', this.imageUrl ?? '');
      this.elementRef.nativeElement.style.transition = '';
      this.elementRef.nativeElement.style.opacity = '0';
    }
  }

  @HostListener('load', ['$event'])
  onLoad() {
    this.elementRef.nativeElement.style.transition = 'opacity 0.5s';
    this.elementRef.nativeElement.style.opacity = '1';
  }
}
