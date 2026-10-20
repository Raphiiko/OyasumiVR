import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  input,
  model,
  signal,
  viewChild,
} from '@angular/core';
import { animate, style, transition, trigger } from '@angular/animations';
import { formatTime, parseTime } from '../../utils/time-utils';

const LIFT_GAP = 12;
// matches the row's transition in time-input.component.scss
const LIFT_MS = 300;

/** The settings row raised above the page while its dial is open. */
interface Lift {
  owner: TimeInputComponent;
  row: HTMLElement;
  placeholder: HTMLElement;
  backdrop: HTMLElement;
  timer?: ReturnType<typeof setTimeout>;
}
let activeLift: Lift | null = null;

/** A 24-hour `HH:mm` field that takes typed text and opens a dial for pointer input. */
@Component({
  selector: 'app-time-input',
  templateUrl: './time-input.component.html',
  styleUrl: './time-input.component.scss',
  animations: [
    // the dial drops in as the raised row reaches its place
    trigger('dialFade', [
      transition(':enter', [
        style({ opacity: 0, transform: 'translateY(-0.75em)' }),
        animate('.2s .15s ease-out'),
      ]),
      transition(':leave', [animate('.15s ease', style({ opacity: 0 }))]),
    ]),
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false,
  host: { '(document:mouseup)': 'release()' },
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
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  /** Set from a press on the field until the button comes up. */
  protected pointerHeld = false;
  private pendingGlide?: () => void;

  constructor() {
    // the dial joins the top layer after the raised row, so it stays above it
    effect(() => {
      const picker = this.picker()?.nativeElement;
      if (!picker) return;
      picker.showPopover();
      this.placeLift(picker);
    });
    inject(DestroyRef).onDestroy(() => {
      if (activeLift?.owner === this) this.settle(activeLift);
    });
  }

  /** Selects the text as well, so typing replaces the time; a dial pick leaves the field focused. */
  protected openDial(field: HTMLInputElement) {
    if (this.disabled() || this.open()) return;
    this.dialMode.set('HOURS');
    this.liftRow();
    this.open.set(true);
    field.select();
  }

  protected close() {
    this.open.set(false);
    this.lowerRow();
  }

  /** Raises the settings row into the top layer, above the modal backdrop that blurs the page. */
  private liftRow() {
    const row = this.host.closest<HTMLElement>('app-setting-row') ?? this.host;

    // reuse the row a neighbouring field in it already raised
    if (activeLift?.row === row) {
      clearTimeout(activeLift.timer);
      activeLift.owner = this;
      return;
    }
    if (activeLift) this.settle(activeLift);

    // hold the row's place in the page and raise it where it stands
    const rect = row.getBoundingClientRect();
    const placeholder = document.createElement('div');
    placeholder.style.height = `${rect.height}px`;
    row.before(placeholder);
    row.popover = 'manual';
    row.classList.add('time-lift');
    Object.assign(row.style, {
      position: 'fixed',
      inset: 'auto',
      margin: '0',
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.width}px`,
    });
    row.showPopover();
    const backdrop = document.createElement('div');
    backdrop.classList.add('modal-wrapper');
    document.body.appendChild(backdrop);
    activeLift = { owner: this, row, placeholder, backdrop };
  }

  /** Glides the raised row and the dial to the same place on screen for every field. */
  private placeLift(picker: HTMLElement) {
    const lift = activeLift;
    if (lift?.owner !== this) return;
    const row = lift.row.getBoundingClientRect();
    const height = row.height + LIFT_GAP + picker.offsetHeight;
    const top = Math.max(LIFT_GAP, (window.innerHeight - height) / 2);
    picker.style.left = `${(window.innerWidth - picker.offsetWidth) / 2}px`;
    picker.style.top = `${top + row.height + LIFT_GAP}px`;
    const glide = () =>
      requestAnimationFrame(() => {
        lift.row.classList.add('lifted');
        lift.backdrop.classList.add('in');
        lift.row.style.left = `${(window.innerWidth - row.width) / 2}px`;
        lift.row.style.top = `${top}px`;
      });

    // the SteamVR keyboard opens only if the field is still under the pointer at release
    if (this.pointerHeld) this.pendingGlide = glide;
    else glide();
  }

  protected release() {
    this.pointerHeld = false;
    this.pendingGlide?.();
    this.pendingGlide = undefined;
  }

  /** Glides the row back into the page, unless another field in it opens first. */
  private lowerRow() {
    const lift = activeLift;
    if (lift?.owner !== this) return;
    clearTimeout(lift.timer);
    lift.timer = setTimeout(() => {
      const home = lift.placeholder.getBoundingClientRect();
      lift.row.classList.remove('lifted');
      lift.backdrop.classList.remove('in');
      lift.row.style.left = `${home.left}px`;
      lift.row.style.top = `${home.top}px`;
      lift.timer = setTimeout(() => this.settle(lift), LIFT_MS);
    });
  }

  private settle(lift: Lift) {
    clearTimeout(lift.timer);
    if (lift.row.matches(':popover-open')) lift.row.hidePopover();
    lift.row.removeAttribute('popover');
    lift.row.classList.remove('time-lift', 'lifted');
    for (const property of ['position', 'inset', 'margin', 'left', 'top', 'width']) {
      lift.row.style.removeProperty(property);
    }
    lift.placeholder.remove();
    lift.backdrop.remove();
    if (activeLift === lift) activeLift = null;
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
    } else if (event.key === 'Escape') {
      field.value = this.text();
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
