import { Component, Input } from '@angular/core';
import { BaseModalComponent } from '../../base-modal/base-modal.component';
import { AppSettingsService } from 'src-ui/app/services/app-settings.service';

@Component({
  selector: 'app-misc-testing',
  templateUrl: './misc-testing.component.html',
  styleUrls: ['./misc-testing.component.scss'],
  standalone: false,
})
export class MiscTestingComponent {
  @Input() modal?: BaseModalComponent<any, any>;

  constructor(private appSettings: AppSettingsService) {}

  clearLighthouseV1Ids() {
    this.appSettings.updateSettings({
      v1LighthouseIdentifiers: {},
    });
  }
}
