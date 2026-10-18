import {
  ChangeDetectorRef,
  Component,
  DestroyRef,
  ElementRef,
  OnChanges,
  OnDestroy,
  OnInit,
  SimpleChanges,
  ViewChild,
  ChangeDetectionStrategy,
  input,
  model,
} from '@angular/core';
import { fade } from '../../utils/animations';
import { debounceTime, Subject } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { SliderComponent, SliderStyle } from '../slider/slider.component';
import { clamp, ensurePrecision, floatPrecision } from '../../utils/number-utils';

@Component({
  selector: 'app-slider-setting',
  templateUrl: './slider-setting.component.html',
  styleUrls: ['./slider-setting.component.scss'],
  animations: [fade()],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false,
})
export class SliderSettingComponent implements OnInit, OnChanges, OnDestroy {
  readonly min = input(0);
  readonly max = input(100);
  readonly style = input<SliderStyle>('DEFAULT');

  readonly value = model(50);
  readonly step = input(1);
  readonly unit = input<string>();
  /** An icon name drawn in the unit box, after any unit text. */
  readonly unitIcon = input<string>();
  readonly snapValues = input<number[]>([]);
  readonly snapDistance = input(5);
  readonly disabled = input(false);
  protected showOverlay = false;
  protected input$ = new Subject<string>();

  set audioLevel(value: number) {
    if (!this.sliderEl) return;
    this.sliderEl.audioLevel = value;
  }

  @ViewChild('inputValue') inputEl?: ElementRef;
  @ViewChild('slider') sliderEl?: SliderComponent;

  constructor(
    private destroyRef: DestroyRef,
    private cdr: ChangeDetectorRef
  ) {}

  ngOnDestroy(): void {
    // complete here, not through DestroyRef: outputs stop emitting once DestroyRef callbacks run
    this.input$.complete();
  }

  ngOnInit(): void {
    this.input$
      .pipe(debounceTime(300), takeUntilDestroyed(this.destroyRef))
      .subscribe((strValue) => this.commitInput(strValue));
  }

  private commitInput(strValue: string) {
    // a value set from outside, such as a reset, replaces the typed text this commit was queued for
    if (this.inputEl && strValue !== this.inputEl.nativeElement.value) return;
    let value = parseFloat(strValue);
    if (!Number.isFinite(value)) return;
    const precision = Math.max(floatPrecision(this.min()), floatPrecision(this.step()));
    const quotient = (value - this.min()) / this.step();
    const epsilon = Number.EPSILON * 4 * Math.max(1, Math.abs(quotient));
    value = clamp(
      ensurePrecision(Math.round(quotient + epsilon) * this.step() + this.min(), precision),
      this.min(),
      this.max()
    );
    if (value === this.value()) return;
    this.value.set(value);
    this.cdr.markForCheck();
  }

  ngOnChanges(changes: SimpleChanges) {
    if (!changes['disabled']?.currentValue) return;
    this.showOverlay = false;
  }

  onInputBlur() {
    this.commitInput(this.inputEl!.nativeElement.value);
    this.inputEl!.nativeElement.value = this.value().toString();
  }

  onSliderChange(value: number) {
    this.value.set(value);
  }

  onMouseEnter() {
    if (this.disabled()) return;
    this.showOverlay = true;
  }
}
