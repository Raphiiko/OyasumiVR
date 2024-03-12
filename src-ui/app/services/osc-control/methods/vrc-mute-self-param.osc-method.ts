import { OscService } from '../../osc.service';
import { OscMethod } from '../osc-method';
import { OSCBoolValue, OSCMessage, OSCStringValue } from '../../../models/osc-message';
import { OscControlService } from '../osc-control.service';

export class VRCMuteSelfParamOscMethod extends OscMethod<boolean> {
  constructor(osc: OscService) {
    super(osc, {
      description: 'Notify OyasumiVR of the current voice mute state in VRChat',
      address: '/MuteSelf',
      addressAliases: [],
      type: 'Bool',
      initialValue: false,
      isVRCAvatarParameter: true,
      access: 'Write',
    });
  }

  async handleOSCMessage(message: OSCMessage) {
    const { value: muteSelf } = message.values[0] as OSCBoolValue;
    if (this.value === muteSelf) return;
    await this.setValue(muteSelf);
  }
}
