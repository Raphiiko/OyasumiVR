import { Component } from '@angular/core';
import { VRChatMicMuteAutomationService } from '../../../services/osc-automations/vrchat-mic-mute-automation.service';
import { invoke } from '@tauri-apps/api';
import { OVRInputEventAction, OVRInputEventActionSet } from '../../../models/ovr-input-event';
import { NotificationService, NotificationSound } from '../../../services/notification.service';

@Component({
  selector: 'app-misc-testing',
  templateUrl: './misc-testing.component.html',
  styleUrls: ['./misc-testing.component.scss'],
})
export class MiscTestingComponent {
  bindings: any;
  soundVolume = 100;

  constructor(
    protected automation: VRChatMicMuteAutomationService,
    private notificationService: NotificationService
  ) {}

  async openBindingConfig() {
    await invoke('openvr_launch_binding_configuration', { showOnDesktop: true });
    await invoke('openvr_launch_binding_configuration', { showOnDesktop: false });
  }

  async getActionBindings() {
    this.bindings = {
      [OVRInputEventAction.OpenOverlay]: await invoke('openvr_get_binding_origins', {
        actionSetKey: OVRInputEventActionSet.Main,
        actionKey: OVRInputEventAction.OpenOverlay,
      }),
      [OVRInputEventAction.MuteMicrophone]: await invoke('openvr_get_binding_origins', {
        actionSetKey: OVRInputEventActionSet.Main,
        actionKey: OVRInputEventAction.MuteMicrophone,
      }),
      [OVRInputEventAction.IndicatePresence]: await invoke('openvr_get_binding_origins', {
        actionSetKey: OVRInputEventActionSet.Hidden,
        actionKey: OVRInputEventAction.IndicatePresence,
      }),
      [OVRInputEventAction.OverlayInteract]: await invoke('openvr_get_binding_origins', {
        actionSetKey: OVRInputEventActionSet.Hidden,
        actionKey: OVRInputEventAction.OverlayInteract,
      }),
    };
  }

  async playSound(sound: NotificationSound) {
    await this.notificationService.playSound(sound, this.soundVolume / 100);
  }
}
