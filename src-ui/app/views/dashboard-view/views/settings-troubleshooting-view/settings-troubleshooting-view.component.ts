import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'app-settings-troubleshooting-view',
  templateUrl: './settings-troubleshooting-view.component.html',
  styleUrls: ['./settings-troubleshooting-view.component.scss'],
  changeDetection: ChangeDetectionStrategy.Eager,
  standalone: false,
})
export class SettingsTroubleshootingViewComponent {
  activeTab: 'STATUS' | 'TOOLS' | 'TWEAKS' = 'STATUS';
}
