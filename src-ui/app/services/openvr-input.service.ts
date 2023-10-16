import { Injectable } from '@angular/core';
import { invoke } from '@tauri-apps/api';
import { OVRInputEvent, OVRInputEventAction } from '../models/ovr-input-event';
import { listen } from '@tauri-apps/api/event';
import { BehaviorSubject } from 'rxjs';
import { cloneDeep, isEqual } from 'lodash';
import { OVRDevice } from '../models/ovr-device';

@Injectable({
  providedIn: 'root',
})
export class OpenVRInputService {
  private _state = new BehaviorSubject<Record<OVRInputEventAction, OVRDevice[]>>({
    [OVRInputEventAction.OpenOverlay]: [],
    [OVRInputEventAction.MuteMicrophone]: [],
    [OVRInputEventAction.SleepCheckDecline]: [],
    [OVRInputEventAction.OverlayInteract]: [],
  });

  public state = this._state.asObservable();

  constructor() {}

  async init() {
    await listen<OVRInputEvent>('OVR_INPUT_EVENT_DIGITAL', (event) => {
      const state = cloneDeep(this._state.value);
      const devices = state[event.payload.action];
      if (event.payload.pressed && !devices.some((d) => d.index === event.payload.device.index)) {
        devices.push(event.payload.device);
      } else if (
        !event.payload.pressed &&
        devices.some((d) => d.index === event.payload.device.index)
      ) {
        const index = devices.findIndex((d) => d.index === event.payload.device.index);
        if (index !== -1) devices.splice(index, 1);
      }
      state[event.payload.action] = devices;
      if (!isEqual(state, this._state.value)) this._state.next(state);
    });
  }

  async launchBindingConfiguration() {
    await invoke('openvr_launch_binding_configuration', { showOnDesktop: true });
    await invoke('openvr_launch_binding_configuration', { showOnDesktop: false });
  }
}
