import {
  Component,
  ElementRef,
  EventEmitter,
  HostListener,
  Input,
  OnChanges,
  OnInit,
  Output,
  SimpleChanges,
  ViewChild,
} from '@angular/core';
import { clamp } from 'lodash';
import { getCSSColorForCCT } from 'src-shared-ts/src/cct-utils';

@Component({
  selector: 'app-brightness-control-slider',
  templateUrl: './brightness-control-slider.component.html',
  styleUrls: ['./brightness-control-slider.component.scss'],
  standalone: false,
})
export class BrightnessControlSliderComponent implements OnInit, OnChanges {
  @Input() min = 0;
  @Input() max = 100;
  @Input() value = 50;
  @Input() step = 0;
  @Input() snapValues: number[] = [];
  @Input() snapDistance: number = 1;
  @Input() transitionActive = false;
  @Input() mode: 'BRIGHTNESS' | 'FAN_SPEED' | 'CCT' = 'BRIGHTNESS';
  @Output() valueChange = new EventEmitter<number>();

  @ViewChild('rangeGuideEl') rangeGuideEl?: ElementRef;

  protected dragging = false;
  protected innerWidth = '0%';
  protected dragValue = 50;
  protected cctColor = 'white';

  get startPadding() {
    switch (this.mode) {
      case 'BRIGHTNESS':
        return 0;
      case 'FAN_SPEED':
        return 1;
      case 'CCT':
        return 2;
    }
  }

  onDragStart = (event: MouseEvent) => {
    event.stopImmediatePropagation();
    if (this.dragging) return;
    this.dragging = true;
    this.onDrag(event);
  };

  @HostListener('window:mouseup', ['$event'])
  onDragEnd = () => {
    if (!this.dragging) return;
    this.dragging = false;
    this.recalculateStyles();
  };

  @HostListener('window:mousemove', ['$event'])
  onDrag = ($event: MouseEvent) => {
    if (!this.dragging || !this.rangeGuideEl) return;
    const barBounds = this.rangeGuideEl!.nativeElement.getBoundingClientRect();
    const startOffset = this.startPadding * 12;
    const progress = clamp(
      ($event.pageX - barBounds.left - startOffset) / (barBounds.width - startOffset),
      0.0,
      1.0
    );
    this.value = Math.round(progress * (this.max - this.min) + this.min);
    if (this.snapValues.length) {
      const snapValue = this.snapValues.find((v) => Math.abs(v - this.value) <= this.snapDistance);
      if (snapValue) this.value = snapValue;
    }
    if (this.step) this.value = Math.round(this.value / this.step) * this.step;
    this.dragValue = this.value;
    this.valueChange.emit(this.value);
    this.recalculateStyles();
  };

  recalculateStyles() {
    let progress;
    if (this.dragging) {
      progress = (this.dragValue - this.min) / (this.max - this.min);
    } else {
      progress = (this.value - this.min) / (this.max - this.min);
    }
    progress = clamp(progress, 0, 1);
    if (this.mode === 'CCT')
      this.cctColor = getCSSColorForCCT(this.dragging ? this.dragValue : this.value);
    this.innerWidth = `calc(calc(100% - 3.75em - ${this.startPadding}em) * ${progress} + 3.75em + ${this.startPadding}em)`;
  }

  ngOnInit(): void {
    this.recalculateStyles();
  }

  ngOnChanges(changes: SimpleChanges) {
    if (
      ['value', 'min', 'max'].some(
        (key) => changes[key] && changes[key].currentValue !== changes[key].previousValue
      )
    )
      this.recalculateStyles();
  }
}
