import {
  Directive,
  ElementRef,
  HostListener,
  OnChanges,
  Renderer2,
  SimpleChanges,
  input,
} from '@angular/core';

@Directive({
  selector: '[imgSmoothLoader]',
  standalone: false,
})
export class ImgSmoothLoaderDirective implements OnChanges {
  readonly imageUrl = input<string | null>(undefined, { alias: 'imgSmoothLoader' });

  constructor(
    private elementRef: ElementRef,
    private renderer: Renderer2
  ) {}

  ngOnChanges(changes: SimpleChanges) {
    if (changes['imageUrl']?.previousValue !== changes['imageUrl']?.currentValue) {
      const imageUrl = this.imageUrl();
      if (!imageUrl) return;
      this.renderer.setAttribute(this.elementRef.nativeElement, 'src', imageUrl ?? '');
      this.elementRef.nativeElement.style.transition = '';
      this.elementRef.nativeElement.style.opacity = '0';
    }
  }

  @HostListener('load')
  onLoad() {
    this.elementRef.nativeElement.style.transition = 'opacity 0.5s';
    this.elementRef.nativeElement.style.opacity = '1';
  }
}
