import {
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { clamp } from 'lodash';
import { getCSSColorForCCT } from 'src-shared-ts/src/cct-utils';

@Component({
  selector: 'app-color-temp-slider',
  templateUrl: './color-temp-slider.html',
  styleUrl: './color-temp-slider.scss',
  host: {
    '(window:mousemove)': 'onMouseMove($event)',
    '(window:mouseup)': 'stopDragging()',
  },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ColorTempSlider {
  readonly label = input('');
  readonly min = input(1000);
  readonly max = input(10000);
  readonly step = input(50);
  readonly snapValues = input<number[]>([6600]);
  readonly snapDistance = input(400);
  readonly value = input(6600);
  readonly disabled = input(false);
  readonly isTransitioning = input(false);
  readonly transitionTarget = input(0);

  readonly valueChange = output<number>();

  private readonly rangeGuide = viewChild<ElementRef<HTMLElement>>('rangeGuide');

  readonly dragging = signal(false);
  readonly dragProgression = signal(0.65);

  readonly renderProgression = computed(() =>
    this.dragging()
      ? this.dragProgression()
      : (this.value() - this.min()) / (this.max() - this.min())
  );

  readonly renderValue = computed(
    () => Math.round(this.renderProgression() * (this.max() - this.min()) + this.min()) + 'K'
  );

  readonly cssColorForCCT = computed(() =>
    getCSSColorForCCT(this.renderProgression() * (this.max() - this.min()) + this.min())
  );

  startDragging(event: MouseEvent): void {
    if (this.dragging()) return;
    this.dragging.set(true);
    this.onMouseMove(event);
  }

  onMouseMove(event: MouseEvent): void {
    const rangeGuide = this.rangeGuide()?.nativeElement;
    if (!this.dragging() || !rangeGuide) return;
    const barBounds = rangeGuide.getBoundingClientRect();
    if (barBounds.width <= 0) return;
    let progress = clamp((event.pageX - barBounds.left) / barBounds.width, 0, 1);
    let value = Math.round(progress * (this.max() - this.min()) + this.min());
    const snapValue = this.snapValues().find((v) => Math.abs(v - value) <= this.snapDistance());
    if (snapValue) value = snapValue;
    if (this.step()) value = Math.round(value / this.step()) * this.step();
    progress = (value - this.min()) / (this.max() - this.min());
    this.dragProgression.set(progress);
    this.valueChange.emit(value);
  }

  stopDragging(): void {
    this.dragging.set(false);
  }
}
