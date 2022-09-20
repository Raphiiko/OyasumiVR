import { Component, Input, OnInit } from '@angular/core';
import { OVRDevice } from 'src/app/models/ovr-device';
import { fade, vshrink } from 'src/app/utils/animations';
import { LighthouseService } from '../../services/lighthouse.service';

@Component({
  selector: 'app-device-list-item',
  templateUrl: './device-list-item.component.html',
  styleUrls: ['./device-list-item.component.scss'],
  animations: [fade(), vshrink()],
})
export class DeviceListItemComponent implements OnInit {
  @Input() device: OVRDevice | undefined;

  constructor(private lighthouse: LighthouseService) {}

  ngOnInit(): void {}

  formatBatteryPercentage(battery: number) {
    return Math.floor(battery * 1000) / 10 + '%';
  }

  turnOffDevice(device: OVRDevice) {
    this.lighthouse.turnOffDevices([device]);
  }
}
