import { OscMethod } from '../osc-method';
import { OscService } from '../../osc.service';
import { OSCBoolValue, OSCMessage } from '../../../models/osc-message';
import { info } from '@tauri-apps/plugin-log';
import { distinctUntilChanged, map, switchMap } from 'rxjs';
import { AutomationConfigService } from '../../automation-config.service';

export class VRCSleepingAnimationsOscMethod extends OscMethod<boolean> {
  constructor(
    osc: OscService,
    private automationConfig: AutomationConfigService
  ) {
    super(osc, {
      description: 'Enabled status of the automation for pose-based sleeping animations in VRChat',
      address: '/OyasumiVR/Automation/VRCSleepingAnimations',
      addressAliases: ['/Oyasumi/SleepingAnimations'],
      type: 'Bool',
      initialValue: false,
      isVRCAvatarParameter: true,
      access: 'ReadWrite',
    });
    automationConfig.configs
      .pipe(
        map((c) => c.SLEEPING_ANIMATIONS.enabled),
        distinctUntilChanged(),
        switchMap((enabled) => this.setValue(enabled))
      )
      .subscribe();
  }

  async handleOSCMessage(message: OSCMessage) {
    const { value: enable } = message.values[0] as OSCBoolValue;
    if (this.value === enable) return;
    await this.setValue(enable);
    if (enable) info('[OSCControl] Enabling sleeping animation automations');
    else info('[OSCControl] Disabling sleeping animation automations');
    await this.automationConfig.updateAutomationConfig('SLEEPING_ANIMATIONS', {
      enabled: enable,
    });
  }
}
