import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';

@Component({
  selector: 'app-dialog',
  imports: [TranslocoPipe],
  templateUrl: './dialog.html',
  styleUrl: './dialog.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Dialog {
  readonly title = input('shared.modals.confirm');
  readonly message = input('');
  readonly confirmText = input('shared.modals.confirm');
  readonly confirmColor = input<'normal' | 'blue' | 'red'>('normal');
  readonly confirmDisabled = input(false);

  readonly cancelled = output<void>();
  readonly confirmed = output<void>();

  readonly confirmActiveColor = computed(() => (this.confirmColor() === 'red' ? 'red' : 'blue'));

  onConfirm(): void {
    if (!this.confirmDisabled()) this.confirmed.emit();
  }
}
