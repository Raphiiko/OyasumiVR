import { OscService } from '../../osc.service';
import { OscMethod } from '../osc-method';
import { OSCMessage, OSCStringValue } from '../../../models/osc-message';
import { OscControlService } from '../osc-control.service';

export class AvatarChangeOscMethod extends OscMethod<string> {
  constructor(osc: OscService, private oscControl: OscControlService) {
    super(osc, {
      description: 'Notify OyasumiVR of the user switching avatar in VRChat',
      address: '/avatar/change',
      addressAliases: [],
      type: 'String',
      initialValue: '',
      isVRCAvatarParameter: false,
      access: 'Write',
    });
  }

  async handleOSCMessage(message: OSCMessage) {
    const { value: avatarId } = message.values[0] as OSCStringValue;
    if (this.value === avatarId) return;
    await this.setValue(avatarId);
    // Trigger resync of all VRChat parameters
    await this.oscControl.resyncAllVRCParameters();
  }
}
