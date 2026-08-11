import { Component, ChangeDetectionStrategy } from '@angular/core';

@Component({
  selector: 'app-hmd-automations-view',
  templateUrl: './hmd-automations-view.component.html',
  styleUrls: ['./hmd-automations-view.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false,
})
export class HmdAutomationsViewComponent {
  protected activeTab: 'BIGSCREEN_BEYOND' = 'BIGSCREEN_BEYOND';
}
