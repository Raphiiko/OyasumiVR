import {
  ChangeDetectorRef,
  Component,
  DestroyRef,
  ElementRef,
  EventEmitter,
  Input,
  OnChanges,
  OnInit,
  Output,
  SimpleChanges,
  ViewChild,
  ChangeDetectionStrategy,
} from '@angular/core';
import { fade } from '../../utils/animations';
import { debounceTime, Subject } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { SliderComponent, SliderStyle } from '../slider/slider.component';
import { clamp, ensurePrecision, floatPrecision } from '../../utils/number-utils';
import { flushOnDestroy } from '../../utils/rxjs-utils';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

@Component({
  selector: 'app-slider-setting',
  templateUrl: './slider-setting.component.html',
  styleUrls: ['./slider-setting.component.scss'],
  animations: [fade()],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false,
})
export class SliderSettingComponent implements OnInit, OnChanges {
  @Input() min = 0;
  @Input() max = 100;
  @Input() style: SliderStyle = 'DEFAULT';

  _value = 50;
  @Input() set value(value: number | null) {
    if (value === null) return;
    this._value = value;
  }

  get value(): number {
    return this._value;
  }

  @Input() step = 1;
  /** Rendered as trusted HTML so it can hold icon markup; pass only fixed strings from templates. */
  @Input() set unit(value: string | undefined) {
    this.unitHtml = value === undefined ? undefined : this.sanitizer.bypassSecurityTrustHtml(value);
  }
  unitHtml?: SafeHtml;
  @Input() snapValues: number[] = [];
  @Input() snapDistance = 5;
  @Input() disabled = false;
  @Output() valueChange = new EventEmitter<number>();
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
    private cdr: ChangeDetectorRef,
    private sanitizer: DomSanitizer
  ) {}

  ngOnInit(): void {
    flushOnDestroy(this.input$, this.destroyRef);
    this.input$
      .pipe(debounceTime(300), takeUntilDestroyed(this.destroyRef))
      .subscribe((strValue) => this.commitInput(strValue));
  }

  private commitInput(strValue: string) {
    let value = parseFloat(strValue);
    if (!Number.isFinite(value)) return;
    const precision = Math.max(floatPrecision(this.min), floatPrecision(this.step));
    const quotient = (value - this.min) / this.step;
    const epsilon = Number.EPSILON * 4 * Math.max(1, Math.abs(quotient));
    value = clamp(
      ensurePrecision(Math.round(quotient + epsilon) * this.step + this.min, precision),
      this.min,
      this.max
    );
    if (value === this.value) return;
    this.value = value;
    this.valueChange.emit(value);
    this.cdr.markForCheck();
  }

  ngOnChanges(changes: SimpleChanges) {
    if (!changes['disabled']?.currentValue) return;
    this.showOverlay = false;
  }

  onInputBlur() {
    this.commitInput(this.inputEl!.nativeElement.value);
    this.inputEl!.nativeElement.value = this.value.toString();
  }

  onSliderChange(value: number) {
    this.value = value;
    this.valueChange.emit(value);
  }

  onMouseEnter() {
    if (this.disabled) return;
    this.showOverlay = true;
  }
}
