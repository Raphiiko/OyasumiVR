import { OscMethod } from '../osc-method';
import { OscService } from '../../osc.service';
import { OSCBoolValue, OSCMessage } from '../../../models/osc-message';
import { info } from '@tauri-apps/plugin-log';
import { distinctUntilChanged, map, switchMap } from 'rxjs';
import { AutomationConfigService } from '../../automation-config.service';

export class VRCPlayerCountStatusAutomationOscMethod extends OscMethod<boolean> {
  constructor(osc: OscService, private automationConfig: AutomationConfigService) {
    super(osc, {
      description:
        'Enabled status of the automation of the VRChat status based on the current player count',
      address: '/OyasumiVR/Automation/VRCPlayerCountStatusAutomation',
      addressAliases: ['/Oyasumi/StatusAutomations'],
      type: 'Bool',
      initialValue: false,
      isVRCAvatarParameter: true,
      access: 'ReadWrite',
    });
    automationConfig.configs
      .pipe(
        map((c) => c.CHANGE_STATUS_BASED_ON_PLAYER_COUNT.enabled),
        distinctUntilChanged(),
        switchMap((enabled) => this.setValue(enabled))
      )
      .subscribe();
  }

  async handleOSCMessage(message: OSCMessage) {
    const { value: enable } = message.values[0] as OSCBoolValue;
    if (this.value === enable) return;
    await this.setValue(enable);
    if (enable) info('[OSCControl] Enabling VRChat player count status automations');
    else info('[OSCControl] Disabling VRChat player count status automations');
    await this.automationConfig.updateAutomationConfig('CHANGE_STATUS_BASED_ON_PLAYER_COUNT', {
      enabled: enable,
    });
  }
}
