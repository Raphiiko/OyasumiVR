import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
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
    () => `all ${Math.max(0, this.duration() - PROGRESS_DELAY)}ms linear`
  );

  constructor() {
    let timer: ReturnType<typeof setTimeout> | undefined;
    effect(() => {
      const active = this.active();
      clearTimeout(timer);
      this.progressing.set(false);
      timer = setTimeout(() => this.progressing.set(active), PROGRESS_DELAY);
    });
    inject(DestroyRef).onDestroy(() => clearTimeout(timer));
  }
}
