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
import { animate, style, transition, trigger } from '@angular/animations';
import { clamp } from '../../utils/number-utils';
import { SettingRowLift } from '../setting-row/setting-row-lift';

@Component({
  selector: 'app-duration-input-setting',
  templateUrl: './duration-input-setting.component.html',
  styleUrl: './duration-input-setting.component.scss',
  animations: [
    // the panel drops in as the raised row reaches its place, like the time dial
    trigger('panelFade', [
      transition(':enter', [
        style({ opacity: 0, transform: 'translateY(-0.75em)' }),
        animate('.2s .15s ease-out'),
      ]),
      transition(':leave', [animate('.15s ease', style({ opacity: 0 }))]),
    ]),
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false,
})
export class DurationInputSettingComponent {
  value = model<number>(0);
  hours = computed(() => Math.floor(this.value() / 3600000));
  minutes = computed(() => Math.floor((this.value() % 3600000) / 60000));
  seconds = computed(() => Math.floor((this.value() % 60000) / 1000));
  displayValue = computed(() => {
    const hours = this.hours().toString().padStart(2, '0');
    const minutes = this.minutes().toString().padStart(2, '0');
    const seconds = this.seconds().toString().padStart(2, '0');
    return `${hours}:${minutes}:${seconds}`;
  });
  readonly disabled = input(false);
  protected readonly open = signal(false);
  private readonly panel = viewChild<ElementRef<HTMLElement>>('panel');
  private readonly hourInput = viewChild<ElementRef<HTMLInputElement>>('hourInput');
  private readonly minuteInput = viewChild<ElementRef<HTMLInputElement>>('minuteInput');
  private readonly secondInput = viewChild<ElementRef<HTMLInputElement>>('secondInput');
  protected readonly lift = new SettingRowLift();

  constructor() {
    // the panel joins the top layer after the raised row, so it stays above it
    effect(() => {
      const panel = this.panel()?.nativeElement;
      if (!panel) return;
      panel.showPopover();
      this.lift.place(panel);
      this.hourInput()?.nativeElement.focus();
    });
  }

  protected openInput() {
    if (this.disabled() || this.open()) return;
    this.lift.raise();
    this.open.set(true);
  }

  protected close() {
    if (!this.open()) return;
    this.open.set(false);
    this.lift.lower();
  }

  /** Closes when focus moves to another field; a click on the backdrop closes through clickOutside. */
  protected onFocusOut(event: FocusEvent, wrapper: HTMLElement) {
    const target = event.relatedTarget;
    if (target instanceof Node && !wrapper.contains(target)) this.close();
  }

  setSeconds($event: string) {
    if (this.disabled()) {
      this.close();
      return;
    }
    let parsed = parseInt($event, 10);
    if (isNaN(parsed)) parsed = 0;
    const seconds = clamp(parsed, 0, 60);
    this.value.set(this.hours() * 3600000 + this.minutes() * 60000 + seconds * 1000);
    if (parsed >= 10) {
      this.secondInput()?.nativeElement.blur();
      this.close();
    }
  }

  setMinutes($event: string) {
    if (this.disabled()) {
      this.close();
      return;
    }
    let parsed = parseInt($event, 10);
    if (isNaN(parsed)) parsed = 0;
    const minutes = clamp(parsed, 0, 60);
    this.value.set(this.hours() * 3600000 + minutes * 60000 + this.seconds() * 1000);
    if (parsed >= 10) this.secondInput()?.nativeElement.focus();
  }

  setHours($event: string) {
    if (this.disabled()) {
      this.close();
      return;
    }
    let parsed = parseInt($event, 10);
    if (isNaN(parsed)) parsed = 0;
    const hours = clamp(parsed, 0, 24);
    this.value.set(hours * 3600000 + this.minutes() * 60000 + this.seconds() * 1000);
    if (parsed >= 10) this.minuteInput()?.nativeElement.focus();
  }
}
