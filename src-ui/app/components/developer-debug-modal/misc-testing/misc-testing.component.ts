import { Component } from '@angular/core';
import { VRChatMicMuteAutomationService } from '../../../services/osc-automations/vrchat-mic-mute-automation.service';

@Component({
  selector: 'app-misc-testing',
  templateUrl: './misc-testing.component.html',
  styleUrls: ['./misc-testing.component.scss'],
})
export class MiscTestingComponent {
  constructor(protected automation: VRChatMicMuteAutomationService) {}
}
