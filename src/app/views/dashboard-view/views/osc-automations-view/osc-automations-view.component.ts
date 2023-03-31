import { Component } from '@angular/core';

@Component({
  selector: 'app-osc-automations-view',
  templateUrl: './osc-automations-view.component.html',
  styleUrls: ['./osc-automations-view.component.scss'],
})
export class OscAutomationsViewComponent {
  activeTab: 'SLEEPING_ANIMATIONS' | 'GENERAL' = 'GENERAL';
}
