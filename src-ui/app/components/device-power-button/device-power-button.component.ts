import { Component, Input, Output, EventEmitter } from '@angular/core';

export type DevicePowerState =
  | 'off'
  | 'on'
  | 'turning-off'
  | 'turning-on'
  | 'unknown'
  | 'attention';
export type DevicePowerAction = 'power-on' | 'power-off';

@Component({
  selector: 'app-device-power-button',
  templateUrl: './device-power-button.component.html',
  styleUrls: ['./device-power-button.component.scss'],
  standalone: false,
})
export class DevicePowerButtonComponent {
  @Input() powerState: DevicePowerState = 'unknown';
  @Input() disabled: boolean = false;
  @Input() title: string = '';
  @Input() id: string = '';
  @Input() anchorName?: string;
  @Input() customIcon: string = '';
  @Input() allowUnknownClick: boolean = false;

  @Output() powerAction = new EventEmitter<DevicePowerAction>();
  @Output() rightClick = new EventEmitter<void>();

  get buttonClass(): string {
    switch (this.powerState) {
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
    if (this.customIcon) {
      return this.customIcon;
    }

    // Default icon logic
    switch (this.powerState) {
      case 'attention':
        return 'key';
      case 'unknown':
        return 'settings_power';
      default:
        return 'power_settings_new';
    }
  }

  get isLoading(): boolean {
    return this.powerState === 'turning-off' || this.powerState === 'turning-on';
  }

  get canClick(): boolean {
    return (
      !this.disabled && !this.isLoading && (this.powerState !== 'unknown' || this.allowUnknownClick)
    );
  }

  get spinnerClass(): string {
    switch (this.powerState) {
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

    if (this.powerState === 'off') {
      this.powerAction.emit('power-on');
    } else if (this.powerState === 'on') {
      this.powerAction.emit('power-off');
    } else if (this.powerState === 'attention') {
      this.powerAction.emit('power-on'); // Handle attention state as power-on
    } else if (this.powerState === 'unknown' && this.allowUnknownClick) {
      this.powerAction.emit('power-on'); // For unknown state, emit power-on (parent can override behavior)
    }
  }

  onRightClick(event: MouseEvent) {
    event.preventDefault();
    this.rightClick.emit();
  }
}
