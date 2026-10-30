import { Component, computed, input, output } from '@angular/core';
import { LighthouseDevicePowerState, LighthouseDeviceType } from '../../models/lighthouse-device';

const FORCE_STATES = [
  { state: 'on', icon: 'power', label: 'comp.device-list.lhForceState.on' },
  { state: 'standby', icon: 'standby', label: 'comp.device-list.lhForceState.standby' },
  { state: 'sleep', icon: 'sleep', label: 'comp.device-list.lhForceState.sleep' },
] as const;

@Component({
  selector: 'app-lighthouse-force-state-buttons',
  templateUrl: './lighthouse-force-state-buttons.component.html',
  styleUrls: ['./lighthouse-force-state-buttons.component.scss'],
  standalone: false,
})
export class LighthouseForceStateButtonsComponent {
  readonly type = input.required<LighthouseDeviceType>();
  /** The settled power state to highlight, or null while it changes or is unknown. */
  readonly state = input<LighthouseDevicePowerState | null>(null);

  readonly forceState = output<LighthouseDevicePowerState>();

  // a V1 base station has no standby
  readonly forceStates = computed(() =>
    this.type() === 'lighthouseV1'
      ? FORCE_STATES.filter((force) => force.state !== 'standby')
      : FORCE_STATES
  );
}
