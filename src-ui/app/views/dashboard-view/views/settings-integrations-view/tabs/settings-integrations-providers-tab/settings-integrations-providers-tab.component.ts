import { Component, ChangeDetectionStrategy } from '@angular/core';
import { PulsoidService } from '../../../../../../services/integrations/pulsoid.service';
import { VRChatService } from '../../../../../../services/vrchat-api/vrchat.service';
import { PULSOID_REFERRAL_ID } from 'src-ui/app/globals';
import { ModalService } from '../../../../../../services/modal.service';
import { MqttConfigModalComponent } from '../../../../../../components/mqtt-config-modal/mqtt-config-modal.component';
import { MqttService } from '../../../../../../services/mqtt/mqtt.service';
import { ToastService } from '../../../../../../services/toast.service';
import { copyWithToast } from '../../../../../../utils/clipboard-utils';
import { VRChatAccountsModalComponent } from '../../../../../../components/vrchat-accounts-modal/vrchat-accounts-modal.component';

@Component({
  selector: 'app-settings-integrations-providers-tab',
  templateUrl: './settings-integrations-providers-tab.component.html',
  styleUrls: ['./settings-integrations-providers-tab.component.scss'],
  changeDetection: ChangeDetectionStrategy.Eager,
  standalone: false,
})
export class SettingsIntegrationsProvidersTabComponent {
  deobfuscated: string[] = [];
  deobfuscationTimers: { [service: string]: any } = {};

  constructor(
    protected pulsoid: PulsoidService,
    protected vrchat: VRChatService,
    protected mqttService: MqttService,
    private modalService: ModalService,
    private toasts: ToastService
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

  protected async copyPulsoidLoginUrl() {
    await copyWithToast(this.toasts, this.pulsoid.getLoginUrl(), 'toasts.clipboard.pulsoidLink');
  }

  protected showMqttConfigModal() {
    this.modalService.addModal(MqttConfigModalComponent).subscribe();
  }

  protected showVRChatAccountsModal() {
    this.modalService.addModal(VRChatAccountsModalComponent).subscribe();
  }
}
