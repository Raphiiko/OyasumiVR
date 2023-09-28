import { Component } from '@angular/core';
import { PulsoidService } from '../../../../../services/integrations/pulsoid.service';
import { hshrink } from '../../../../../utils/animations';
import { VRChatService } from '../../../../../services/vrchat.service';

@Component({
  selector: 'app-settings-integrations-tab',
  templateUrl: './settings-integrations-tab.component.html',
  styleUrls: ['./settings-integrations-tab.component.scss'],
  animations: [hshrink()],
})
export class SettingsIntegrationsTabComponent {
  deobfuscatePulsoidUsername: boolean = false;
  deobfuscated: string[] = [];
  deobfuscationTimers: { [service: string]: any } = {};

  constructor(protected pulsoid: PulsoidService, protected vrchat: VRChatService) {}

  protected deobfuscate(service: string) {
    if (!this.deobfuscated.includes(service)) this.deobfuscated.push(service);
    if (this.deobfuscationTimers[service]) clearTimeout(this.deobfuscationTimers[service]);
    this.deobfuscationTimers[service] = setTimeout(() => {
      this.deobfuscated = this.deobfuscated.filter((s) => s !== service);
      this.deobfuscationTimers[service] = undefined;
    }, 5000);
  }
}
