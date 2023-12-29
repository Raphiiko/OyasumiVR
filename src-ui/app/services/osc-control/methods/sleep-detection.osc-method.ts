import { OscMethod } from '../osc-method';
import { OscService } from '../../osc.service';
import { OSCBoolValue, OSCMessage } from '../../../models/osc-message';
import { info } from 'tauri-plugin-log-api';
import { distinctUntilChanged, map, switchMap } from 'rxjs';
import { AutomationConfigService } from '../../automation-config.service';

export class SleepDetectionOscMethod extends OscMethod<boolean> {
  constructor(osc: OscService, private automationConfig: AutomationConfigService) {
    super(osc, {
      description: 'Enabled status of the sleep detection automation',
      address: '/OyasumiVR/Automation/SleepDetection',
      addressAliases: ['/Oyasumi/SleepDetection'],
      type: 'Bool',
      initialValue: false,
      isVRCAvatarParameter: true,
      access: 'ReadWrite',
    });
    automationConfig.configs
      .pipe(
        map((c) => c.SLEEP_MODE_ENABLE_FOR_SLEEP_DETECTOR.enabled),
        distinctUntilChanged(),
        switchMap((enabled) => this.setValue(enabled))
      )
      .subscribe();
  }

  async handleOSCMessage(message: OSCMessage) {
    const { value: enable } = message.values[0] as OSCBoolValue;
    if (this.value === enable) return;
    await this.setValue(enable);
    if (enable) info('[OSCControl] Enabling sleep detection');
    else info('[OSCControl] Disabling sleep detection');
    await this.automationConfig.updateAutomationConfig('SLEEP_MODE_ENABLE_FOR_SLEEP_DETECTOR', {
      enabled: enable,
    });
  }
}
