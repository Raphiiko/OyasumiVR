import { Component, ChangeDetectionStrategy } from '@angular/core';
import { fade, vshrink } from '../../../../utils/animations';

@Component({
  selector: 'app-device-manager-view',
  templateUrl: './device-manager-view.component.html',
  styleUrls: ['./device-manager-view.component.scss'],
  animations: [fade(), vshrink()],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false,
})
export class DeviceManagerViewComponent {
  activeTab: 'devices' | 'tags' = 'devices';

  constructor() {}
}
