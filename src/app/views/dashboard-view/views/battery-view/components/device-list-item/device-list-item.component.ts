import { Component, Input, OnInit } from '@angular/core';
import { OVRDevice } from '../../../../../../models/ovr-device';
import { fade, vshrink } from '../../../../../../utils/animations';
import { OpenVRService } from '../../../../../../services/openvr.service';

@Component({
  selector: 'app-device-list-item',
  templateUrl: './device-list-item.component.html',
  styleUrls: ['./device-list-item.component.scss'],
  animations: [fade(), vshrink()],
})
export class DeviceListItemComponent implements OnInit {
  @Input() device: OVRDevice | undefined;

  constructor(private openvr: OpenVRService) {}

  ngOnInit(): void {}

  formatBatteryPercentage(battery: number) {
    return Math.floor(battery * 1000) / 10 + '%';
  }

  turnOffDevice(device: OVRDevice) {
    this.openvr.turnOffDevices([device]);
  }
}
