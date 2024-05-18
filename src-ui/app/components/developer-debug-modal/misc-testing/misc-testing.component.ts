import { Component, Input, OnInit } from '@angular/core';
import { VRChatMicMuteAutomationService } from '../../../services/osc-automations/vrchat-mic-mute-automation.service';
import { BaseModalComponent } from '../../base-modal/base-modal.component';
import { VRChatService } from '../../../services/vrchat.service';

@Component({
  selector: 'app-misc-testing',
  templateUrl: './misc-testing.component.html',
  styleUrls: ['./misc-testing.component.scss'],
})
export class MiscTestingComponent implements OnInit {
  @Input() modal?: BaseModalComponent<any, any>;

  constructor(
    protected automation: VRChatMicMuteAutomationService,
    protected vrchat: VRChatService
  ) {}

  ngOnInit(): void {}
}
