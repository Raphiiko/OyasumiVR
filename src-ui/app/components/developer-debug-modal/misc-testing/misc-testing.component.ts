import { Component } from '@angular/core';
import { VRChatMicMuteAutomationService } from '../../../services/osc-automations/vrchat-mic-mute-automation.service';
import { invoke } from '@tauri-apps/api';
import { OVRInputEventAction, OVRInputEventActionSet } from '../../../models/ovr-input-event';

@Component({
  selector: 'app-misc-testing',
  templateUrl: './misc-testing.component.html',
  styleUrls: ['./misc-testing.component.scss'],
})
export class MiscTestingComponent {
  bindings: any;

  constructor(protected automation: VRChatMicMuteAutomationService) {}

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
      [OVRInputEventAction.SleepCheckDecline]: await invoke('openvr_get_binding_origins', {
        actionSetKey: OVRInputEventActionSet.Hidden,
        actionKey: OVRInputEventAction.SleepCheckDecline,
      }),
      [OVRInputEventAction.OverlayInteract]: await invoke('openvr_get_binding_origins', {
        actionSetKey: OVRInputEventActionSet.Hidden,
        actionKey: OVRInputEventAction.OverlayInteract,
      }),
    };
  }
}
