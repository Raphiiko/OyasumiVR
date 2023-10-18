import { OVRDevice } from './ovr-device';

export enum OVRInputEventActionSet {
  Main = '/actions/main',
  Hidden = '/actions/hidden',
}

export enum OVRInputEventAction {
  OpenOverlay = '/actions/main/in/OpenOverlay',
  MuteMicrophone = '/actions/main/in/MuteMicrophone',
  IndicatePresence = '/actions/hidden/in/IndicatePresence',
  OverlayInteract = '/actions/hidden/in/OverlayInteract',
}

type OVRInputEventActionValue = `${OVRInputEventAction}`;

export interface OVRInputEvent {
  action: OVRInputEventActionValue;
  pressed: boolean;
  timeAgo: number;
  device: OVRDevice;
}
