import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  input,
  model,
  signal,
  viewChild,
} from '@angular/core';
import { formatTime, parseTime } from '../../utils/time-utils';
import { fade } from '../../utils/animations';

/** A 24-hour `HH:mm` field that takes typed text and opens a dial for pointer input. */
@Component({
  selector: 'app-time-input',
  templateUrl: './time-input.component.html',
  styleUrl: './time-input.component.scss',
  animations: [fade()],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false,
})
export class TimeInputComponent {
  readonly value = model<string | null>(null);
  readonly disabled = input(false);
  /** Hides the time-of-day marks, for a field that holds a length of time. */
  readonly duration = input(false);
  protected readonly open = signal(false);
  protected readonly dialMode = signal<'HOURS' | 'MINUTES'>('HOURS');
  /** Null while the caller holds no time, which shows as an empty field. */
  protected readonly time = computed(() => parseTime(this.value() ?? ''));
  protected readonly hours = computed(() => this.time()?.[0] ?? null);
  protected readonly minutes = computed(() => this.time()?.[1] ?? null);
  protected readonly text = computed(() => {
    const time = this.time();
    return time ? formatTime(...time) : '';
  });
  protected readonly handAngle = computed(() =>
    this.dialMode() === 'HOURS' ? (this.hours() ?? 0) * 15 : (this.minutes() ?? 0) * 6
  );
  protected readonly hourTicks = Array.from({ length: 24 }, (_, i) => this.tick(i, 24, i));
  protected readonly minuteTicks = Array.from({ length: 12 }, (_, i) => this.tick(i, 12, i * 5));
  private readonly picker = viewChild<ElementRef<HTMLElement>>('picker');

  constructor() {
    // the top layer keeps the dial above other fields and outside clipping containers
    effect(() => this.picker()?.nativeElement.showPopover());
  }

  protected openDial() {
    if (this.disabled() || this.open()) return;
    this.dialMode.set('HOURS');
    this.open.set(true);
  }

  protected close() {
    this.open.set(false);
  }

  protected pickHour(hours: number) {
    this.value.set(formatTime(hours, this.minutes() ?? 0));
    this.dialMode.set('MINUTES');
  }

  protected pickMinute(minutes: number) {
    this.value.set(formatTime(this.hours() ?? 0, minutes));
    this.close();
  }

  protected commit(field: HTMLInputElement) {
    const parsed = parseTime(field.value);
    if (parsed) this.value.set(formatTime(...parsed));
    field.value = this.text();
  }

  protected onKeyDown(event: KeyboardEvent, field: HTMLInputElement) {
    if (event.key === 'Enter') {
      field.blur();
      this.close();
    } else if (event.key === 'Escape') {
      field.value = this.text();
      this.close();
    } else if (event.key === 'Tab') {
      this.close();
    }
  }

  private tick(index: number, count: number, value: number) {
    const angle = (index / count) * 2 * Math.PI;
    return {
      value,
      label: value.toString().padStart(2, '0'),
      left: `${50 + 40 * Math.sin(angle)}%`,
      top: `${50 - 40 * Math.cos(angle)}%`,
    };
  }
}
