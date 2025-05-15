import { Component } from '@angular/core';
import { warn } from '@tauri-apps/plugin-log';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import { hshrink } from 'src-ui/app/utils/animations';
import { PulsoidService } from '../../../../services/integrations/pulsoid.service';
import { VRChatService } from '../../../../services/vrchat-api/vrchat.service';
import { PULSOID_REFERRAL_ID } from 'src-ui/app/globals';
import { ModalService } from '../../../../services/modal.service';
import { MqttConfigModalComponent } from '../../../../components/mqtt-config-modal/mqtt-config-modal.component';
import { MqttService } from '../../../../services/mqtt/mqtt.service';

@Component({
  selector: 'app-settings-integrations-view',
  templateUrl: './settings-integrations-view.component.html',
  styleUrls: ['./settings-integrations-view.component.scss'],
  animations: [hshrink()],
  standalone: false,
})
export class SettingsIntegrationsViewComponent {
  deobfuscated: string[] = [];
  deobfuscationTimers: { [service: string]: any } = {};
  copiedToClipboard: string[] = [];

  constructor(
    protected pulsoid: PulsoidService,
    protected vrchat: VRChatService,
    protected mqttService: MqttService,
    private modalService: ModalService
  ) {}

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
      case 'PULSOID': {
        const url = this.pulsoid.getLoginUrl();
        await writeText(url);
        break;
      }
      default:
        warn('Tried copying link for unknown service');
        break;
    }
  }

  protected showMqttConfigModal() {
    this.modalService.addModal(MqttConfigModalComponent).subscribe();
  }
}
