import {
  AfterViewInit,
  Directive,
  ElementRef,
  HostListener,
  OnChanges,
  OnDestroy,
  input,
} from '@angular/core';
import { TString } from '../models/translatable-string';
import { TStringTranslatePipe } from '../pipes/tstring-translate.pipe';

@Directive({
  selector: '[tooltip]',
  standalone: false,
})
export class TooltipDirective implements AfterViewInit, OnChanges, OnDestroy {
  readonly text = input<TString>(undefined, { alias: 'tooltip' });
  readonly mode = input<'top' | 'bottom' | 'left' | 'right'>('top', { alias: 'tooltipMode' });
  readonly textAlign = input<'left' | 'center' | 'right'>('center', { alias: 'tooltipTextAlign' });
  readonly margin = input<number | undefined>(4, { alias: 'tooltipMargin' });
  private initialized = false;
  private tooltipElement?: HTMLElement;
  private resizeObserver?: ResizeObserver;
  private anchorFrame?: number;
  private anchorRect?: DOMRect;

  constructor(
    private elementRef: ElementRef,
    private tsTranslate: TStringTranslatePipe
  ) {}

  ngAfterViewInit() {
    this.initialized = true;
  }

  ngOnDestroy() {
    this.onMouseLeave();
  }

  ngOnChanges() {
    if (this.tooltipElement) {
      this.onMouseLeave();
      this.onMouseEnter();
    }
  }

  @HostListener('mouseenter')
  onMouseEnter() {
    if (!this.initialized || this.tooltipElement) return;
    const text = this.text();
    if (!text) return;
    const tooltipElement = document.createElement('div');
    tooltipElement.classList.add('ovr-tooltip');
    tooltipElement.classList.add('ovr-tooltip-text-align-' + this.textAlign());
    const container = document.createElement('div');
    container.classList.add('ovr-tooltip-container');
    tooltipElement.appendChild(container);
    container.innerText = this.tsTranslate.transform(text) as string;
    document.body.appendChild(tooltipElement);
    this.tooltipElement = tooltipElement;
    this.positionTooltip();
    this.anchorFrame = requestAnimationFrame(this.trackAnchor);
    window.addEventListener('resize', this.positionTooltip);
    document.addEventListener('scroll', this.positionTooltip, true);
    this.resizeObserver = new ResizeObserver(this.positionTooltip);
    this.resizeObserver.observe(tooltipElement);
    setTimeout(() => {
      if (this.tooltipElement === tooltipElement) tooltipElement.classList.add('shown');
    }, 10);
  }

  private positionTooltip = () => {
    if (!this.tooltipElement) return;
    const anchor = this.elementRef.nativeElement.getBoundingClientRect();
    const { width, height } = this.tooltipElement.getBoundingClientRect();
    const viewport = document.documentElement;
    const inset = 8;
    const margin = this.margin() ?? 4;
    const positions = {
      top: { x: anchor.left + (anchor.width - width) / 2, y: anchor.top - height - margin },
      bottom: { x: anchor.left + (anchor.width - width) / 2, y: anchor.bottom + margin },
      left: { x: anchor.left - width - margin, y: anchor.top + (anchor.height - height) / 2 },
      right: { x: anchor.right + margin, y: anchor.top + (anchor.height - height) / 2 },
    };
    const fits = {
      top: positions.top.y >= inset,
      bottom: positions.bottom.y + height <= viewport.clientHeight - inset,
      left: positions.left.x >= inset,
      right: positions.right.x + width <= viewport.clientWidth - inset,
    };
    const opposite = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' } as const;
    const mode =
      !fits[this.mode()] && fits[opposite[this.mode()]] ? opposite[this.mode()] : this.mode();
    const { x, y } = positions[mode];
    this.tooltipElement.style.left = `${Math.max(inset, Math.min(x, viewport.clientWidth - width - inset))}px`;
    this.tooltipElement.style.top = `${Math.max(inset, Math.min(y, viewport.clientHeight - height - inset))}px`;
  };

  private trackAnchor = () => {
    if (!this.tooltipElement) return;
    const rect = this.elementRef.nativeElement.getBoundingClientRect();
    const previous = this.anchorRect;
    this.anchorRect = rect;
    if (
      !previous ||
      previous.left !== rect.left ||
      previous.top !== rect.top ||
      previous.width !== rect.width ||
      previous.height !== rect.height
    ) {
      this.positionTooltip();
    }
    this.anchorFrame = requestAnimationFrame(this.trackAnchor);
  };

  @HostListener('mouseleave')
  onMouseLeave() {
    if (!this.initialized || !this.tooltipElement) return;
    const tooltipElement = this.tooltipElement;
    this.tooltipElement = undefined;
    if (this.anchorFrame !== undefined) {
      cancelAnimationFrame(this.anchorFrame);
      this.anchorFrame = undefined;
    }
    this.anchorRect = undefined;
    window.removeEventListener('resize', this.positionTooltip);
    document.removeEventListener('scroll', this.positionTooltip, true);
    this.resizeObserver?.disconnect();
    this.resizeObserver = undefined;
    tooltipElement.classList.remove('shown');
    setTimeout(() => {
      tooltipElement.remove();
    }, 300);
  }
}
