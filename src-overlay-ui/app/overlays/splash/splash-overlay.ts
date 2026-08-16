import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';

@Component({
  selector: 'app-splash-overlay',
  imports: [TranslocoPipe],
  templateUrl: './splash-overlay.html',
  styleUrl: './splash-overlay.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SplashOverlay implements OnInit {
  protected readonly ready = signal(false);
  protected readonly showIcon = signal(false);
  protected readonly showLogoText = signal(false);
  protected readonly showTagLine = signal(false);
  protected readonly inOverlay = !!window.CefSharp;

  private readonly timers: ReturnType<typeof setTimeout>[] = [];

  constructor() {
    inject(DestroyRef).onDestroy(() => this.timers.forEach(clearTimeout));
  }

  ngOnInit(): void {
    this.ready.set(true);
    void window.OyasumiIPCOut.onUiReady();
    // milliseconds from mount
    this.at(200, () => this.showIcon.set(true));
    this.at(400, () => this.showLogoText.set(true));
    this.at(600, () => this.showTagLine.set(true));
    this.at(5600, () => this.hideEverything());
    this.at(7600, () => void window.OyasumiIPCOut.dispose());
  }

  private hideEverything(): void {
    this.showIcon.set(false);
    this.showLogoText.set(false);
    this.showTagLine.set(false);
  }

  private at(delay: number, action: () => void): void {
    this.timers.push(setTimeout(action, delay));
  }
}
