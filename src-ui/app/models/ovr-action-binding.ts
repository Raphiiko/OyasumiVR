export type OVRActionBindingSlotName = 'double' | 'click' | 'long' | 'held' | 'touch' | 'null';
export type OVRActionBindingInputSourceType = 'button' | 'joystick' | 'trigger';
export type OVRActionBindingModeName = OVRActionBindingInputSourceType;

export interface OVRActionBinding {
  devicePathName: string; // e.g. "/user/hand/right"
  inputPathName: string; // e.g. "/input/a"
  inputSourceType: OVRActionBindingInputSourceType;
  localizedControllerType: string; // e.g. "Index Controller"
  localizedHand: string; // e.g. "Right Hand"
  localizedInputSource: string; // e.g. "A Button"
  modeName: OVRActionBindingModeName;
  slotName: OVRActionBindingSlotName;
}
