import {
  AfterViewInit,
  ChangeDetectorRef,
  Component,
  ElementRef,
  EventEmitter,
  HostListener,
  Input,
  OnChanges,
  OnDestroy,
  OnInit,
  Output,
  SimpleChanges,
  ViewChild,
} from '@angular/core';
import { orderBy } from 'lodash';
import { clamp, ensurePrecision, floatPrecision } from '../../utils/number-utils';

@Component({
  selector: 'app-slider',
  templateUrl: './slider.component.html',
  styleUrls: ['./slider.component.scss'],
})
export class SliderComponent implements OnInit, OnChanges, OnDestroy, AfterViewInit {
  @Input() min = 0;
  @Input() max = 100;
  @Input() value = 50;
  @Input() step = 1;
  @Input() unit?: string;
  @Input() snapValues: number[] = [];
  @Input() snapDistance = 5;
  @Output() valueChange = new EventEmitter<number>();
  protected dragging = false;
  protected thumbStyleLeft = '0px';
  protected trackFillStyleWidth = '0%';
  protected trackStopStyleLeft: string[] = [];
  protected snapIndicatorStyleLeft: string[] = [];

  @ViewChild('thumbEl') thumbEl?: ElementRef;

  constructor(private el: ElementRef, private cdr: ChangeDetectorRef) {}

  ngOnChanges(changes: SimpleChanges): void {
    this.recalculateStyles();
  }

  ngOnDestroy(): void {}

  ngOnInit(): void {}

  ngAfterViewInit() {
    this.recalculateStyles();
  }

  onDragStart = (event: MouseEvent) => {
    event.stopImmediatePropagation();
    if (this.dragging) return;
    this.dragging = true;
    this.onDrag(event);
  };

  @HostListener('window:mouseup', ['$event'])
  onDragEnd = ($event: MouseEvent) => {
    if (!this.dragging) return;
    this.dragging = false;
  };

  @HostListener('window:mousemove', ['$event'])
  onDrag = ($event: MouseEvent) => {
    if (!this.dragging || !this.el || !this.thumbEl) return;
    const componentBounds = this.el.nativeElement.getBoundingClientRect();
    const thumbBounds = this.thumbEl!.nativeElement.getBoundingClientRect();
    const min = componentBounds.left + thumbBounds.width / 2;
    const max = componentBounds.left + componentBounds.width - thumbBounds.width / 2;
    const offset = clamp($event.pageX, min, max);
    let value = ((offset - min) / (max - min)) * (this.max - this.min) + this.min;
    // Handle snapping
    const snapTo = orderBy(
      this.snapValues
        .map((snapValue) => {
          return {
            snapValue,
            distance: Math.abs(value - snapValue),
          };
        })
        .filter((i) => i.distance <= this.snapDistance),
      ['distance'],
      'asc'
    ).at(0)?.snapValue;
    if (snapTo !== undefined) {
      value = snapTo;
    }
    // Handle snapping to step sizes
    if (snapTo === undefined) {
      value = Math.round(value / this.step) * this.step;
    }
    this.value = clamp(ensurePrecision(value, floatPrecision(this.step)), this.min, this.max);
    this.valueChange.emit(this.value);
    this.recalculateStyles();
  };

  recalculateStyles() {
    // Thumb offset
    const width = this.el?.nativeElement?.offsetWidth ?? 0;
    const thumbWidth = this.thumbEl?.nativeElement?.offsetWidth ?? 0;
    const min = thumbWidth / 2;
    const max = width - thumbWidth / 2;
    const thumbOffset = ((this.value - this.min) / (this.max - this.min)) * (max - min) + min;
    this.thumbStyleLeft = `${thumbOffset}px`;
    // Track fill width
    this.trackFillStyleWidth = ((this.value - this.min) / (this.max - this.min)) * 100 + '%';
    // Track stops
    const trackWidth = width - thumbWidth;
    this.trackStopStyleLeft = this.snapValues.map((snapValue) => {
      const stopOffset = (snapValue - this.min) / (this.max - this.min);
      return `calc(${stopOffset} * calc(${trackWidth}px - 0.15em))`;
    });
    this.snapIndicatorStyleLeft = this.snapValues.map((snapValue) => {
      const stopOffset = (snapValue - this.min) / (this.max - this.min);
      return `calc(${stopOffset} * calc(${trackWidth}px - 1em))`;
    });
    this.cdr.detectChanges();
  }
}
