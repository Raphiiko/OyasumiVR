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

@Component({
  selector: 'app-brightness-slider',
  templateUrl: './brightness-slider.html',
  styleUrl: './brightness-slider.scss',
  host: {
    '(window:mousemove)': 'onMouseMove($event)',
    '(window:mouseup)': 'stopDragging()',
  },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BrightnessSlider {
  readonly label = input('');
  readonly min = input(0);
  readonly max = input(100);
  readonly value = input(100);
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

  readonly renderPercentage = computed(() =>
    Math.round(this.renderProgression() * (this.max() - this.min()) + this.min())
  );

  startDragging(event: MouseEvent): void {
    if (this.dragging() || this.disabled()) return;
    this.dragging.set(true);
    this.onMouseMove(event);
  }

  onMouseMove(event: MouseEvent): void {
    const rangeGuide = this.rangeGuide()?.nativeElement;
    if (!this.dragging() || this.disabled() || !rangeGuide) return;
    const barBounds = rangeGuide.getBoundingClientRect();
    if (barBounds.width <= 0) return;
    const progress = clamp((event.clientX - barBounds.left) / barBounds.width, 0, 1);
    this.dragProgression.set(progress);
    this.valueChange.emit(Math.round(progress * (this.max() - this.min()) + this.min()));
  }

  stopDragging(): void {
    this.dragging.set(false);
  }
}
