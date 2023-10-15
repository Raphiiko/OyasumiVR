import { Component } from '@angular/core';
import { VRChatMicMuteAutomationService } from '../../../services/osc-automations/vrchat-mic-mute-automation.service';
import { invoke } from '@tauri-apps/api';

@Component({
  selector: 'app-misc-testing',
  templateUrl: './misc-testing.component.html',
  styleUrls: ['./misc-testing.component.scss'],
})
export class MiscTestingComponent {
  constructor(protected automation: VRChatMicMuteAutomationService) {}

  async openBindingConfig() {
    await invoke('openvr_launch_binding_configuration', { showOnDesktop: true });
    await invoke('openvr_launch_binding_configuration', { showOnDesktop: false });
  }
}
