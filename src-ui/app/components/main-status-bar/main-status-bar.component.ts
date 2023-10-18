import { Component, OnInit } from '@angular/core';
import { SleepService } from '../../services/sleep.service';
import { VRChatService } from '../../services/vrchat.service';
import { UserStatus } from 'vrchat/dist';
import { hshrink, noop } from '../../utils/animations';
import { firstValueFrom } from 'rxjs';
import { OpenVRService } from '../../services/openvr.service';
import { BackgroundService } from '../../services/background.service';
import { OscService } from '../../services/osc.service';
import { DisplayBrightnessControlService } from '../../services/brightness-control/display-brightness-control.service';
import { ImageBrightnessControlService } from '../../services/brightness-control/image-brightness-control.service';
import { SimpleBrightnessControlService } from '../../services/brightness-control/simple-brightness-control.service';
import { ModalService } from '../../services/modal.service';
import { BrightnessControlModalComponent } from '../brightness-control-modal/brightness-control-modal.component';
import { BrightnessControlAutomationService } from '../../services/brightness-control/brightness-control-automation.service';
import { PulsoidService } from '../../services/integrations/pulsoid.service';
import { Router } from '@angular/router';
import { SystemMicMuteAutomationService } from 'src-ui/app/services/system-mic-mute-automation.service';

@Component({
  selector: 'app-main-status-bar',
  templateUrl: './main-status-bar.component.html',
  styleUrls: ['./main-status-bar.component.scss'],
  animations: [hshrink(), noop()],
})
export class MainStatusBarComponent implements OnInit {
  protected sleepMode = this.sleepService.mode;
  protected user = this.vrchat.user;
  private brightnessControlModalOpen = false;

  constructor(
    private sleepService: SleepService,
    private vrchat: VRChatService,
    private modalService: ModalService,
    private router: Router,
    protected systemMicMuteAutomation: SystemMicMuteAutomationService,
    protected openvr: OpenVRService,
    protected background: BackgroundService,
    protected osc: OscService,
    protected displayBrightnessControl: DisplayBrightnessControlService,
    protected imageBrightnessControl: ImageBrightnessControlService,
    protected simpleBrightnessControl: SimpleBrightnessControlService,
    protected brightnessAutomations: BrightnessControlAutomationService,
    protected pulsoid: PulsoidService
  ) {}

  ngOnInit(): void {}

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
      this.modalService.addModal<BrightnessControlModalComponent>(
        BrightnessControlModalComponent,
        undefined,
        {
          id: 'BrightnessControlModal',
        }
      )
    );
    this.brightnessControlModalOpen = false;
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
    const url = window.location.pathname;
    if (window.location.pathname !== '/dashboard/systemMicMuteAutomations') {
      return 'NAVIGATE';
    } else {
      return 'TOGGLE_MUTE';
    }
  }

  async navigateToVRChatSettings() {
    await this.router.navigateByUrl('/', { skipLocationChange: true });
    await this.router.navigate(['dashboard', 'settings'], { fragment: 'VRCHAT' });
  }
}
