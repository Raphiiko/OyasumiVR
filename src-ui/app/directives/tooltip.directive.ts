import {
  AfterViewInit,
  Directive,
  ElementRef,
  HostListener,
  Input,
  OnChanges,
  OnDestroy,
  SimpleChanges,
} from '@angular/core';
import { TString } from '../models/translatable-string';
import { TStringTranslatePipe } from '../pipes/tstring-translate.pipe';

@Directive({
  // eslint-disable-next-line @angular-eslint/directive-selector
  selector: '[tooltip]',
})
export class TooltipDirective implements AfterViewInit, OnChanges, OnDestroy {
  @Input('tooltip') text?: TString;
  @Input('tooltipMode') mode?: 'top' | 'bottom' | 'left' | 'right' = 'top';
  @Input('tooltipMargin') margin?: number = 4;
  private initialized = false;
  private tooltipElement?: HTMLElement;

  constructor(private elementRef: ElementRef, private tsTranslate: TStringTranslatePipe) {}

  ngAfterViewInit() {
    this.initialized = true;
  }

  ngOnDestroy() {
    this.onMouseLeave();
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['text'].currentValue !== changes['text'].previousValue) {
      const open = !!this.tooltipElement;
      this.onMouseLeave();
      if (open) {
        this.onMouseEnter();
      }
    }
  }

  @HostListener('mouseenter', ['$event'])
  onMouseEnter() {
    if (!this.initialized || this.tooltipElement) return;
    if (!this.text) return;
    const tooltipElement = document.createElement('div');
    tooltipElement.classList.add('ovr-tooltip');
    tooltipElement.classList.add('ovr-tooltip-' + this.mode);
    tooltipElement.style.setProperty('--offset', this.margin + 'px');
    const container = document.createElement('div');
    container.classList.add('ovr-tooltip-container');
    tooltipElement.appendChild(container);
    container.innerText = this.tsTranslate.transform(this.text) as string;
    this.elementRef.nativeElement.style.position = 'relative';
    (this.elementRef.nativeElement as HTMLElement).insertAdjacentElement(
      'afterbegin',
      tooltipElement
    );
    this.tooltipElement = tooltipElement;
    setTimeout(() => tooltipElement.classList.add('shown'), 10);
  }

  @HostListener('mouseleave', ['$event'])
  onMouseLeave() {
    if (!this.initialized || !this.tooltipElement) return;
    const tooltipElement = this.tooltipElement;
    this.tooltipElement = undefined;
    tooltipElement.classList.remove('shown');
    setTimeout(() => {
      tooltipElement.remove();
    }, 300);
  }
}
