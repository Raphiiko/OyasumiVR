import { Component } from '@angular/core';
import { noop } from '../../../../utils/animations';

@Component({
  selector: 'app-status-automations-view',
  templateUrl: './status-automations-view.component.html',
  styleUrls: ['./status-automations-view.component.scss'],
  animations: [noop()],
})
export class StatusAutomationsViewComponent {
  activeTab: 'GENERAL' | 'PLAYER_LIMIT' = 'PLAYER_LIMIT';
}
