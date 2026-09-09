import { Injectable } from '@angular/core';
import { invoke } from '@tauri-apps/api/core';
import {
  OVRInputEvent,
  OVRInputEventAction,
  OVRInputEventActionSet,
} from '../models/ovr-input-event';
import { listen } from '@tauri-apps/api/event';
import { BehaviorSubject, distinctUntilChanged, firstValueFrom, merge, scan, Subject } from 'rxjs';
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
    const events = new Subject<OVRInputEvent>();
    merge(this.openvr.status, events)
      .pipe(
        scan(
          (state, event) => {
            if (typeof event === 'string') {
              return {
                initialized: event === 'INITIALIZED',
                actions:
                  event === 'INITIALIZED'
                    ? state.actions
                    : {
                        [OVRInputEventAction.OpenOverlay]: [],
                        [OVRInputEventAction.MuteMicrophone]: [],
                        [OVRInputEventAction.IndicatePresence]: [],
                        [OVRInputEventAction.OverlayInteract]: [],
                      },
              };
            }
            const { action, pressed, device } = event;
            if (!state.initialized || !device) return state;
            const actions = structuredClone(state.actions);
            const devices = actions[action] ?? [];
            if (pressed && !devices.some((d) => d.index === device.index)) {
              devices.push(device);
            } else if (!pressed) {
              const index = devices.findIndex((d) => d.index === device.index);
              if (index !== -1) devices.splice(index, 1);
            }
            actions[action] = devices;
            return { ...state, actions };
          },
          {
            initialized: false,
            actions: this._state.value,
          }
        ),
        distinctUntilChanged((previous, current) => isEqual(previous.actions, current.actions))
      )
      .subscribe(({ actions }) => this._state.next(actions));
    await listen<OVRInputEvent>('OVR_INPUT_EVENT_DIGITAL', (event) => events.next(event.payload));
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
