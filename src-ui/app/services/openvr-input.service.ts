import { Injectable } from '@angular/core';
import {
  OVRInputEvent,
  OVRInputEventAction,
  OVRInputEventActionSet,
} from '../models/ovr-input-event';
import { BehaviorSubject, firstValueFrom, Subject, withLatestFrom } from 'rxjs';
import { isEqual } from 'lodash';
import { fromCoreDevice, OVRDevice } from '../models/ovr-device';
import { commands, events } from 'src-ui/app/bindings';
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
    this.openvr.status.subscribe((status) => {
      if (
        status === 'INITIALIZED' ||
        !Object.values(this._state.value).some((devices) => devices.length)
      )
        return;
      this._state.next({
        [OVRInputEventAction.OpenOverlay]: [],
        [OVRInputEventAction.MuteMicrophone]: [],
        [OVRInputEventAction.IndicatePresence]: [],
        [OVRInputEventAction.OverlayInteract]: [],
      });
    });

    const inputEvents = new Subject<OVRInputEvent>();
    inputEvents.pipe(withLatestFrom(this.openvr.status)).subscribe(([event, status]) => {
      const { action, pressed, device } = event;
      if (status !== 'INITIALIZED' || !device) return;
      const state = structuredClone(this._state.value);
      const devices = state[action];
      if (pressed && !devices.some((d) => d.index === device.index)) {
        devices.push(device);
      } else if (!pressed && devices.some((d) => d.index === device.index)) {
        const index = devices.findIndex((d) => d.index === device.index);
        if (index !== -1) devices.splice(index, 1);
      }
      state[action] = devices;
      if (!isEqual(state, this._state.value)) this._state.next(state);
    });
    await events.openVrInputEvent.listen(({ payload }) =>
      inputEvents.next({
        ...payload,
        // the core sends only the actions OVRInputEventAction lists
        action: payload.action as OVRInputEvent['action'],
        device: payload.device && fromCoreDevice(payload.device),
      })
    );
  }

  async launchBindingConfiguration(showOnDesktop: boolean) {
    await commands.openvrLaunchBindingConfiguration(showOnDesktop);
  }

  async getActionBindings(actionSet: OVRInputEventActionSet, action: OVRInputEventAction) {
    const status = await firstValueFrom(this.openvr.status);
    if (status !== 'INITIALIZED') return [];
    const result = await commands.openvrGetBindingOrigins(actionSet, action);
    if (result.status === 'error') throw result.error;
    return result.data.filter((b) => b.slotName && b.slotName.trim() && b.slotName !== 'null');
  }
}
