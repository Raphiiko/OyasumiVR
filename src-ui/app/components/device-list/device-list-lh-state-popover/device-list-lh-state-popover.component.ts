import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { hshrink } from '../../../utils/animations';
import {
  LighthouseDevicePowerState,
  LighthouseDeviceType,
} from '../../../models/lighthouse-device';

@Component({
  selector: 'app-device-list-lh-state-popover',
  templateUrl: './device-list-lh-state-popover.component.html',
  styleUrls: ['./device-list-lh-state-popover.component.scss'],
  animations: [hshrink()],
  standalone: false,
})
export class DeviceListLhStatePopoverComponent implements OnInit {
  hoverAction = '';
  active = false;
  @Output() action = new EventEmitter<LighthouseDevicePowerState>();
  @Input() type?: LighthouseDeviceType;

  ngOnInit() {
    setTimeout(() => (this.active = true), 150);
  }

  setHoverAction(action: string) {
    if (!this.active) return;
    this.hoverAction = action;
  }
}
