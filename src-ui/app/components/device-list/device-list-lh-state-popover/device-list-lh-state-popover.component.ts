import { Component, EventEmitter, OnInit, Output } from '@angular/core';
import { hshrink, vshrink } from '../../../utils/animations';
import { LighthouseDevicePowerState } from '../../../models/lighthouse-device';

@Component({
  selector: 'app-device-list-lh-state-popover',
  templateUrl: './device-list-lh-state-popover.component.html',
  styleUrls: ['./device-list-lh-state-popover.component.scss'],
  animations: [hshrink()],
})
export class DeviceListLhStatePopoverComponent implements OnInit {
  hoverAction = '';
  active = false;
  @Output() action = new EventEmitter<LighthouseDevicePowerState>();

  ngOnInit() {
    setTimeout(() => (this.active = true), 150);
  }

  setHoverAction(action: string) {
    if (!this.active) return;
    this.hoverAction = action;
  }
}
