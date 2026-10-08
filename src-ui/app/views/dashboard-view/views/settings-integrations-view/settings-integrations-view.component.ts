import { Component, ChangeDetectionStrategy } from '@angular/core';

@Component({
  selector: 'app-settings-integrations-view',
  templateUrl: './settings-integrations-view.component.html',
  styleUrls: ['./settings-integrations-view.component.scss'],
  changeDetection: ChangeDetectionStrategy.Eager,
  standalone: false,
})
export class SettingsIntegrationsViewComponent {
  activeTab: 'PROVIDERS' | 'VRCX' | 'DISCORD' = 'PROVIDERS';
}
