import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { hshrink } from '../../utils/animations';
import {
    LighthouseDevicePowerState,
    LighthouseDeviceType,
} from '../../models/lighthouse-device';
import { DevicePowerAction } from '../device-power-button/device-power-button.component';

@Component({
    selector: 'app-lighthouse-force-state-popover',
    templateUrl: './lighthouse-force-state-popover.component.html',
    styleUrls: ['./lighthouse-force-state-popover.component.scss'],
    animations: [hshrink()],
    standalone: false,
})
export class LighthouseForceStatePopoverComponent implements OnInit {
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

    // Helper methods for power button components
    onPowerAction(state: LighthouseDevicePowerState, action: DevicePowerAction) {
        if (action === 'power-on' && state === 'on') {
            this.action.emit('on');
        } else if (action === 'power-off' && (state === 'standby' || state === 'sleep')) {
            this.action.emit(state);
        }
    }

    getButtonTitle(state: LighthouseDevicePowerState): string {
        return `comp.device-list.lhForceState.${state}`;
    }
} 