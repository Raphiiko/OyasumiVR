import { Component, ChangeDetectionStrategy, input, output } from '@angular/core';

export type DevicePowerState =
  'off' | 'on' | 'turning-off' | 'turning-on' | 'unknown' | 'attention';
export type DevicePowerAction = 'power-on' | 'power-off';

@Component({
  selector: 'app-device-power-button',
  templateUrl: './device-power-button.component.html',
  styleUrls: ['./device-power-button.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false,
})
export class DevicePowerButtonComponent {
  readonly powerState = input<DevicePowerState>('unknown');
  readonly disabled = input<boolean>(false);
  readonly id = input<string>('');
  readonly anchorName = input<string>();
  readonly customIcon = input<string>('');
  readonly allowUnknownClick = input<boolean>(false);

  readonly powerAction = output<DevicePowerAction>();
  readonly rightClick = output<void>();

  get buttonClass(): string {
    switch (this.powerState()) {
      case 'off':
      case 'turning-on':
        return 'btn-power power-on';
      case 'on':
      case 'turning-off':
        return 'btn-power power-off';
      case 'attention':
        return 'btn-power power-attention';
      case 'unknown':
      default:
        return 'btn-power power-unknown';
    }
  }

  get iconName(): string {
    // Use custom icon if provided
    const customIcon = this.customIcon();
    if (customIcon) {
      return customIcon;
    }

    // Default icon logic
    switch (this.powerState()) {
      case 'attention':
        return 'key';
      default:
        return 'power';
    }
  }

  get isLoading(): boolean {
    const powerState = this.powerState();
    return powerState === 'turning-off' || powerState === 'turning-on';
  }

  get canClick(): boolean {
    return (
      !this.disabled() &&
      !this.isLoading &&
      (this.powerState() !== 'unknown' || this.allowUnknownClick())
    );
  }

  get spinnerClass(): string {
    switch (this.powerState()) {
      case 'turning-off':
        return 'power-off';
      case 'turning-on':
        return 'power-on';
      default:
        return 'power-unknown';
    }
  }

  onClick() {
    if (!this.canClick) return;

    const powerState = this.powerState();
    if (powerState === 'off') {
      this.powerAction.emit('power-on');
    } else if (powerState === 'on') {
      this.powerAction.emit('power-off');
    } else if (powerState === 'attention') {
      this.powerAction.emit('power-on'); // Handle attention state as power-on
    } else if (powerState === 'unknown' && this.allowUnknownClick()) {
      this.powerAction.emit('power-on'); // For unknown state, emit power-on (parent can override behavior)
    }
  }

  onRightClick(event: MouseEvent) {
    event.preventDefault();
    this.rightClick.emit();
  }
}
