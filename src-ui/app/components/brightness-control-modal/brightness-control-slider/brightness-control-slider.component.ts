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

@Component({
  selector: 'app-brightness-control-slider',
  templateUrl: './brightness-control-slider.component.html',
  styleUrls: ['./brightness-control-slider.component.scss'],
})
export class BrightnessControlSliderComponent implements OnInit, OnChanges {
  @Input() min = 0;
  @Input() max = 100;
  @Input() value = 50;
  @Input() step = 1;
  @Output() valueChange = new EventEmitter<number>();

  @ViewChild('rangeGuideEl') rangeGuideEl?: ElementRef;

  protected dragging = false;
  protected innerWidth = '0%';
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
  };

  @HostListener('window:mousemove', ['$event'])
  onDrag = ($event: MouseEvent) => {
    if (!this.dragging || !this.rangeGuideEl) return;
    const barBounds = this.rangeGuideEl!.nativeElement.getBoundingClientRect();
    const progress = clamp(($event.pageX - barBounds.left) / barBounds.width, 0.0, 1.0);
    this.value = Math.round(progress * (this.max - this.min) + this.min);
    this.valueChange.emit(this.value);
    this.recalculateStyles();
  };

  recalculateStyles() {
    const progress = (this.value - this.min) / (this.max - this.min);
    this.innerWidth = `calc(calc(100% - 3.75em) * ${progress} + 3.75em)`;
  }

  ngOnInit(): void {
    this.recalculateStyles();
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['value'] && changes['value'].currentValue !== changes['value'].previousValue)
      this.recalculateStyles();
  }
}
