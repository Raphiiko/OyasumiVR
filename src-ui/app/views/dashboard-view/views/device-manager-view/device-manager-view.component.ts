import { Component, ChangeDetectionStrategy, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
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
  // a link can open the Tags tab with ?tab=tags
  activeTab: 'devices' | 'tags' =
    inject(ActivatedRoute).snapshot.queryParamMap.get('tab') === 'tags' ? 'tags' : 'devices';
}
