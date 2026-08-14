import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  input,
  signal,
} from '@angular/core';

/** The progress bar only starts filling once the notification has finished animating in. */
const PROGRESS_DELAY = 800;

@Component({
  selector: 'app-notification',
  templateUrl: './notification.html',
  styleUrl: './notification.scss',
  host: {
    'animate.enter': 'anim-fade-in',
    'animate.leave': 'anim-blur-out',
  },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Notification {
  readonly message = input('');
  readonly duration = input(3000);
  readonly active = input(false);

  protected readonly progressing = signal(false);
  protected readonly progressTransition = computed(
    () => `all ${this.duration() - PROGRESS_DELAY}ms linear`
  );

  constructor() {
    const timer = setTimeout(() => this.progressing.set(this.active()), PROGRESS_DELAY);
    inject(DestroyRef).onDestroy(() => clearTimeout(timer));
  }
}
