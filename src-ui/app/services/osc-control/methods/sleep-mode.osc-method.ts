import { OscMethod } from '../osc-method';
import { OscService } from '../../osc.service';
import { OSCBoolValue, OSCMessage } from '../../../models/osc-message';
import { SleepService } from '../../sleep.service';
import { info } from '@tauri-apps/plugin-log';
import { switchMap } from 'rxjs';

export class SleepModeOscMethod extends OscMethod<boolean> {
  constructor(osc: OscService, private sleep: SleepService) {
    super(osc, {
      description: 'Enabled status of the sleep mode',
      address: '/OyasumiVR/SleepMode',
      addressAliases: ['/Oyasumi/SleepMode'],
      type: 'Bool',
      initialValue: false,
      isVRCAvatarParameter: true,
      access: 'ReadWrite',
    });
    sleep.mode.pipe(switchMap((mode) => this.setValue(mode))).subscribe();
  }

  async handleOSCMessage(message: OSCMessage) {
    const { value: enable } = message.values[0] as OSCBoolValue;
    if (this.value === enable) return;
    await this.setValue(enable);
    if (enable) {
      info('[OSCControl] Activating sleep mode');
      await this.sleep.enableSleepMode({ type: 'OSC_CONTROL' });
    } else {
      info('[OSCControl] Deactivating sleep mode');
      await this.sleep.disableSleepMode({ type: 'OSC_CONTROL' });
    }
  }
}
