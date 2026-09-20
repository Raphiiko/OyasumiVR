import { ChangeDetectionStrategy, Component } from '@angular/core';
import { ToastRef, ToastService, ToastType } from 'src-ui/app/services/toast.service';

@Component({
  selector: 'app-toast-testing',
  templateUrl: './toast-testing.component.html',
  styleUrls: ['./toast-testing.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false,
})
export class ToastTestingComponent {
  protected readonly types: ToastType[] = ['info', 'success', 'warning', 'error', 'pending'];

  private countdown?: ToastRef;

  constructor(private toastService: ToastService) {}

  protected showType(type: ToastType) {
    this.toastService.show({
      type,
      title: `A ${type} toast`,
      message: 'With a message that runs long enough to wrap onto a second line.',
      duration: type === 'pending' ? 0 : 4000,
      dismissable: type !== 'pending',
    });
  }

  protected showTitleOnly() {
    this.toastService.show({ type: 'success', title: 'Copied to clipboard', duration: 3000 });
  }

  protected showWithActions() {
    this.toastService.show({
      type: 'warning',
      title: 'A toast with actions',
      message: 'The first action dismisses it, the second one leaves it up.',
      duration: 15000,
      actions: [
        { label: 'Dismiss', action: (toast) => toast.dismiss() },
        { label: 'Keep', action: () => undefined },
      ],
    });
  }

  protected showUndismissable() {
    this.toastService.show({
      type: 'pending',
      title: 'You cannot dismiss this one',
      message: 'It stays up until something dismisses it in code.',
      duration: 0,
      dismissable: false,
    });
  }

  protected showCountdown() {
    this.countdown = this.toastService.show({
      type: 'warning',
      title: 'OyasumiVR quits in a moment',
      message: 'SteamVR stopped. Running automations finish first.',
      duration: 10000,
      dismissable: false,
      actions: [{ label: 'Quit now', action: (toast) => toast.dismiss() }],
    });
  }

  protected cancelCountdown() {
    this.countdown?.update({
      type: 'success',
      title: 'Quit cancelled',
      message: 'SteamVR started again, so OyasumiVR stays open.',
      duration: 4000,
      dismissable: true,
      actions: [],
    });
  }

  protected showSeveral() {
    this.types.forEach((type, index) => setTimeout(() => this.showType(type), index * 250));
  }

  protected dismissAll() {
    this.toastService.dismissAll();
  }
}
