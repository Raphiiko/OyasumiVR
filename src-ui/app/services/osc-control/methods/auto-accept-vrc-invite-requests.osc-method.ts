import { OscMethod } from '../osc-method';
import { OscService } from '../../osc.service';
import { OSCBoolValue, OSCMessage } from '../../../models/osc-message';
import { info } from '@tauri-apps/plugin-log';
import { distinctUntilChanged, map, switchMap } from 'rxjs';
import { AutomationConfigService } from '../../automation-config.service';

export class AutoAcceptVRCInviteRequestsOscMethod extends OscMethod<boolean> {
  constructor(
    osc: OscService,
    private automationConfig: AutomationConfigService
  ) {
    super(osc, {
      description:
        'Enabled status of the automation for automatically accepting VRChat invite requests',
      address: '/OyasumiVR/Automation/AutoAcceptVRCInviteRequests',
      addressAliases: ['/Oyasumi/AutoAcceptInviteRequests'],
      type: 'Bool',
      initialValue: false,
      isVRCAvatarParameter: true,
      access: 'ReadWrite',
    });
    automationConfig.configs
      .pipe(
        map((c) => c.AUTO_ACCEPT_INVITE_REQUESTS.enabled),
        distinctUntilChanged(),
        switchMap((enabled) => this.setValue(enabled))
      )
      .subscribe();
  }

  async handleOSCMessage(message: OSCMessage) {
    const { value: enable } = message.values[0] as OSCBoolValue;
    if (this.value === enable) return;
    await this.setValue(enable);
    if (enable) info('[OSCControl] Enabling automatic invite request acceptance');
    else info('[OSCControl] Disabling automatic invite request acceptance');
    await this.automationConfig.updateAutomationConfig('AUTO_ACCEPT_INVITE_REQUESTS', {
      enabled: enable,
    });
  }
}
