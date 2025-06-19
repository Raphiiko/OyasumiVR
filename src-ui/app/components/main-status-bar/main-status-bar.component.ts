import { Component, DestroyRef, OnInit } from '@angular/core';
import { SleepService } from '../../services/sleep.service';
import { VRChatService } from '../../services/vrchat-api/vrchat.service';
import { UserStatus } from 'vrchat/dist';
import { hshrink, noop } from '../../utils/animations';
import { firstValueFrom } from 'rxjs';
import { OpenVRService } from '../../services/openvr.service';
import { BackgroundService } from '../../services/background.service';
import { OscService } from '../../services/osc.service';
import { HardwareBrightnessControlService } from '../../services/brightness-control/hardware-brightness-control.service';
import { SoftwareBrightnessControlService } from '../../services/brightness-control/software-brightness-control.service';
import { SimpleBrightnessControlService } from '../../services/brightness-control/simple-brightness-control.service';
import { ModalService } from '../../services/modal.service';
import { BrightnessControlModalComponent } from '../brightness-control-modal/brightness-control-modal.component';
import { BrightnessCctAutomationService } from '../../services/brightness-cct-automation.service';
import { PulsoidService } from '../../services/integrations/pulsoid.service';
import { Router } from '@angular/router';
import { SystemMicMuteAutomationService } from 'src-ui/app/services/system-mic-mute-automation.service';
import { AppSettingsService } from 'src-ui/app/services/app-settings.service';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { BigscreenBeyondFanAutomationService } from 'src-ui/app/services/hmd-specific-automations/bigscreen-beyond-fan-automation.service';
import { BSBFanSpeedControlModalComponent } from '../bsb-fan-speed-control-modal/bsb-fan-speed-control-modal.component';
import { MqttService } from '../../services/mqtt/mqtt.service';
import { CCTControlService } from '../../services/cct-control/cct-control.service';
import { CCTControlModalComponent } from '../cct-control-modal/cct-control-modal.component';

@Component({
  selector: 'app-main-status-bar',
  templateUrl: './main-status-bar.component.html',
  styleUrls: ['./main-status-bar.component.scss'],
  animations: [hshrink(), noop()],
  standalone: false,
})
export class MainStatusBarComponent implements OnInit {
  protected sleepMode = this.sleepService.mode;
  protected user = this.vrchat.user;
  private brightnessControlModalOpen = false;
  private bsbFanSpeedControlModalOpen = false;
  private cctControlModalOpen = false;
  protected snowverlayAvailable = new Date().getDate() >= 18 && new Date().getMonth() == 11;
  protected snowverlayActive = false;
  protected mqttStatus: 'DISABLED' | 'CONNECTED' | 'DISCONNECTED' | 'ERROR' = 'DISABLED';
  protected cctControlEnabled = false;

  constructor(
    private sleepService: SleepService,
    private vrchat: VRChatService,
    private modalService: ModalService,
    private router: Router,
    private settings: AppSettingsService,
    private destroyRef: DestroyRef,
    private mqttService: MqttService,
    protected systemMicMuteAutomation: SystemMicMuteAutomationService,
    protected openvr: OpenVRService,
    protected background: BackgroundService,
    protected osc: OscService,
    protected hardwareBrightnessControl: HardwareBrightnessControlService,
    protected softwareBrightnessControl: SoftwareBrightnessControlService,
    protected simpleBrightnessControl: SimpleBrightnessControlService,
    protected brightnessCctAutomations: BrightnessCctAutomationService,
    protected pulsoid: PulsoidService,
    protected bigscreenBeyondFanAutomation: BigscreenBeyondFanAutomationService,
    protected cctControl: CCTControlService
  ) {}

  ngOnInit(): void {
    this.settings.settings.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((settings) => {
      this.snowverlayActive = !settings.hideSnowverlay && this.snowverlayAvailable;
      this.cctControlEnabled = settings.cctControlEnabled;
    });
    this.mqttService.clientStatus.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((status) => {
      this.mqttStatus = status;
    });
  }

  getStatusColor(status: UserStatus) {
    switch (status) {
      case UserStatus.Active:
        return 'var(--color-vrchat-status-green)';
      case UserStatus.JoinMe:
        return 'var(--color-vrchat-status-blue)';
      case UserStatus.AskMe:
        return 'var(--color-vrchat-status-orange)';
      case UserStatus.Busy:
        return 'var(--color-vrchat-status-red)';
      case UserStatus.Offline:
        return 'black';
    }
  }

  async toggleSleepMode() {
    if (await firstValueFrom(this.sleepService.mode)) {
      await this.sleepService.disableSleepMode({ type: 'MANUAL' });
    } else {
      await this.sleepService.enableSleepMode({ type: 'MANUAL' });
    }
  }

  async openBrightnessControlModal() {
    if (this.brightnessControlModalOpen) {
      this.modalService.closeModal('BrightnessControlModal');
      return;
    }
    this.brightnessControlModalOpen = true;
    await firstValueFrom(
      this.modalService.addModal(BrightnessControlModalComponent, undefined, {
        id: 'BrightnessControlModal',
      })
    );
    this.brightnessControlModalOpen = false;
  }

  async openBSBFanSpeedControlModal() {
    if (this.bsbFanSpeedControlModalOpen) {
      this.modalService.closeModal('BSBFanSpeedControlModal');
      return;
    }
    this.bsbFanSpeedControlModalOpen = true;
    await firstValueFrom(
      this.modalService.addModal(BSBFanSpeedControlModalComponent, undefined, {
        id: 'BSBFanSpeedControlModal',
      })
    );
    this.bsbFanSpeedControlModalOpen = false;
  }

  async doSystemMicrophoneMuteAction() {
    switch (this.systemMicrophoneMuteAction()) {
      case 'NAVIGATE':
        await this.router.navigate(['dashboard', 'systemMicMuteAutomations']);
        break;
      case 'TOGGLE_MUTE':
        this.systemMicMuteAutomation.toggleMute();
        break;
    }
  }

  systemMicrophoneMuteAction() {
    if (window.location.pathname !== '/dashboard/systemMicMuteAutomations') {
      return 'NAVIGATE';
    } else {
      return 'TOGGLE_MUTE';
    }
  }

  async navigateToIntegrationSettings() {
    await this.router.navigateByUrl('/', { skipLocationChange: true });
    await this.router.navigate(['dashboard', 'settings', 'integrations']);
  }

  toggleSnowverlay() {
    this.settings.updateSettings({
      hideSnowverlay: this.snowverlayActive,
    });
  }

  async openCCTControlModal() {
    if (this.cctControlModalOpen) {
      this.modalService.closeModal('CCTControlModal');
      return;
    }
    this.cctControlModalOpen = true;
    await firstValueFrom(
      this.modalService.addModal(CCTControlModalComponent, undefined, {
        id: 'CCTControlModal',
      })
    );
    this.cctControlModalOpen = false;
  }
}
