import { Injectable } from '@angular/core';
import { invoke } from '@tauri-apps/api/core';
import {
  OVRInputEvent,
  OVRInputEventAction,
  OVRInputEventActionSet,
} from '../models/ovr-input-event';
import { listen } from '@tauri-apps/api/event';
import { BehaviorSubject, firstValueFrom } from 'rxjs';
import { isEqual } from 'lodash';
import { OVRDevice } from '../models/ovr-device';
import { OVRActionBinding } from '../models/ovr-action-binding';
import { OpenVRService } from './openvr.service';

@Injectable({
  providedIn: 'root',
})
export class OpenVRInputService {
  private _state = new BehaviorSubject<Record<OVRInputEventAction, OVRDevice[]>>({
    [OVRInputEventAction.OpenOverlay]: [],
    [OVRInputEventAction.MuteMicrophone]: [],
    [OVRInputEventAction.IndicatePresence]: [],
    [OVRInputEventAction.OverlayInteract]: [],
  });

  public state = this._state.asObservable();

  constructor(private openvr: OpenVRService) {}

  async init() {
    await listen<OVRInputEvent>('OVR_INPUT_EVENT_DIGITAL', (event) => {
      const state = structuredClone(this._state.value);
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

  async launchBindingConfiguration(showOnDesktop: boolean) {
    await invoke('openvr_launch_binding_configuration', { showOnDesktop });
  }

  async getActionBindings(actionSet: OVRInputEventActionSet, action: OVRInputEventAction) {
    const status = await firstValueFrom(this.openvr.status);
    if (status !== 'INITIALIZED') return [];
    let bindings = await invoke<OVRActionBinding[]>('openvr_get_binding_origins', {
      actionSetKey: actionSet,
      actionKey: action,
    });
    bindings = bindings.filter((b) => b.slotName && b.slotName.trim() && b.slotName !== 'null');
    return bindings;
  }
}
