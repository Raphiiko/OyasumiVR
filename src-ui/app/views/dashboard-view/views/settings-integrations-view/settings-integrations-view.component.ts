import { Component, DestroyRef, OnInit } from '@angular/core';
import { warn } from '@tauri-apps/plugin-log';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import { hshrink } from 'src-ui/app/utils/animations';
import { PulsoidService } from '../../../../services/integrations/pulsoid.service';
import { VRChatService } from '../../../../services/vrchat-api/vrchat.service';
import { PULSOID_REFERRAL_ID } from 'src-ui/app/globals';
import { ModalService } from '../../../../services/modal.service';
import { MqttConfigModalComponent } from '../../../../components/mqtt-config-modal/mqtt-config-modal.component';
import { MqttService } from '../../../../services/mqtt/mqtt.service';
import { SelectBoxItem } from 'src-ui/app/components/select-box/select-box.component';
import { AppSettingsService } from 'src-ui/app/services/app-settings.service';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { APP_SETTINGS_DEFAULT, AppSettings, DiscordActivityMode } from 'src-ui/app/models/settings';

@Component({
  selector: 'app-settings-integrations-view',
  templateUrl: './settings-integrations-view.component.html',
  styleUrls: ['./settings-integrations-view.component.scss'],
  animations: [hshrink()],
  standalone: false,
})
export class SettingsIntegrationsViewComponent implements OnInit {
  deobfuscated: string[] = [];
  deobfuscationTimers: { [service: string]: any } = {};
  copiedToClipboard: string[] = [];

  discordActivityModeOptions: SelectBoxItem[] = [
    {
      id: 'ENABLED',
      label: 'settings.integrations.discord.activityMode.options.ENABLED',
    },
    {
      id: 'ONLY_ASLEEP',
      label: 'settings.integrations.discord.activityMode.options.ONLY_ASLEEP',
    },
    {
      id: 'DISABLED',
      label: 'settings.integrations.discord.activityMode.options.DISABLED',
    },
  ];
  discordActivityModeOption: SelectBoxItem | undefined;
  appSettings: AppSettings = structuredClone(APP_SETTINGS_DEFAULT);

  constructor(
    protected pulsoid: PulsoidService,
    protected vrchat: VRChatService,
    protected mqttService: MqttService,
    protected settingsService: AppSettingsService,
    private modalService: ModalService,
    private destroyRef: DestroyRef
  ) {}

  ngOnInit(): void {
    this.settingsService.settings
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((settings) => {
        this.appSettings = settings;
        this.discordActivityModeOption = this.discordActivityModeOptions.find(
          (o) => o.id === settings.discordActivityMode
        );
      });
  }

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

  protected setDiscordActivityOnlyWhenVRChatIsRunning(enabled: boolean) {
    this.settingsService.updateSettings({ discordActivityOnlyWhileVRChatIsRunning: enabled });
  }

  protected onChangeDiscordActivityMode(option: SelectBoxItem | undefined) {
    if (!option) return;
    this.settingsService.updateSettings({
      discordActivityMode: option!.id as DiscordActivityMode,
    });
  }

  protected toggleVrcxLogSleepMode() {
    if (this.appSettings.vrcxLogsEnabled.includes('SleepMode')) {
      this.settingsService.updateSettings({
        vrcxLogsEnabled: this.appSettings.vrcxLogsEnabled.filter((e) => e !== 'SleepMode'),
      });
    } else {
      this.settingsService.updateSettings({
        vrcxLogsEnabled: [...this.appSettings.vrcxLogsEnabled, 'SleepMode'],
      });
    }
  }
}
