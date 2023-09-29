import { Component } from '@angular/core';
import { PulsoidService } from '../../../../../services/integrations/pulsoid.service';
import { hshrink } from '../../../../../utils/animations';
import { VRChatService } from '../../../../../services/vrchat.service';
import { PULSOID_REFERRAL_ID } from '../../../../../globals';
import { warn } from 'tauri-plugin-log-api';
import { writeText } from '@tauri-apps/api/clipboard';

@Component({
  selector: 'app-settings-integrations-tab',
  templateUrl: './settings-integrations-tab.component.html',
  styleUrls: ['./settings-integrations-tab.component.scss'],
  animations: [hshrink()],
})
export class SettingsIntegrationsTabComponent {
  deobfuscatePulsoidUsername = false;
  deobfuscated: string[] = [];
  deobfuscationTimers: { [service: string]: any } = {};
  copiedToClipboard: string[] = [];

  constructor(protected pulsoid: PulsoidService, protected vrchat: VRChatService) {}

  protected deobfuscate(service: string) {
    if (!this.deobfuscated.includes(service)) this.deobfuscated.push(service);
    if (this.deobfuscationTimers[service]) clearTimeout(this.deobfuscationTimers[service]);
    this.deobfuscationTimers[service] = setTimeout(() => {
      this.deobfuscated = this.deobfuscated.filter((s) => s !== service);
      this.deobfuscationTimers[service] = undefined;
    }, 5000);
  }

  protected readonly PULSOID_REFERRAL_ID = PULSOID_REFERRAL_ID;

  protected async copyToClipboard(service: string) {
    this.copiedToClipboard.push(service);
    setTimeout(() => {
      const index = this.copiedToClipboard.findIndex((s) => s === service);
      if (index > -1) this.copiedToClipboard.splice(index, 1);
    }, 1000);

    switch (service) {
      case 'PULSOID':
        const url = this.pulsoid.getLoginUrl();
        await writeText(url);
        break;
      default:
        warn('Tried copying link for unknown service');
        break;
    }
  }
}
