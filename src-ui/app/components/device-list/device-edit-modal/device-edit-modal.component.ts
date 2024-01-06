import { Component, OnInit } from '@angular/core';
import { BaseModalComponent } from '../../base-modal/base-modal.component';
import { OVRDevice } from '../../../models/ovr-device';
import { LighthouseDevice } from '../../../models/lighthouse-device';
import { fadeUp } from '../../../utils/animations';
import { TranslateService } from '@ngx-translate/core';
import { OpenVRService } from '../../../services/openvr.service';
import { LighthouseService } from '../../../services/lighthouse.service';

export interface DeviceEditModalInputModel {
  deviceType?: 'LIGHTHOUSE' | 'OPENVR';
  lighthouseDevice?: LighthouseDevice;
  ovrDevice?: OVRDevice;
}

export interface DeviceEditModalOutputModel {}

@Component({
  selector: 'app-device-edit-modal',
  templateUrl: './device-edit-modal.component.html',
  styleUrls: ['./device-edit-modal.component.scss'],
  animations: [fadeUp()],
})
export class DeviceEditModalComponent
  extends BaseModalComponent<DeviceEditModalInputModel, DeviceEditModalOutputModel>
  implements OnInit, DeviceEditModalInputModel
{
  deviceType?: 'LIGHTHOUSE' | 'OPENVR';
  lighthouseDevice?: LighthouseDevice;
  ovrDevice?: OVRDevice;
  ignoreLighthouse = false;
  nickname = '';

  constructor(
    private translate: TranslateService,
    private openvr: OpenVRService,
    private lighthouseService: LighthouseService
  ) {
    super();
  }

  ngOnInit(): void {
    switch (this.deviceType) {
      case 'LIGHTHOUSE': {
        this.nickname = this.lighthouseService.getDeviceNickname(this.lighthouseDevice!) ?? '';
        this.ignoreLighthouse = this.lighthouseService.isDeviceIgnored(this.lighthouseDevice!);
        break;
      }
      case 'OPENVR': {
        this.nickname = this.openvr.getDeviceNickname(this.ovrDevice!) ?? '';
        break;
      }
    }
  }

  async save() {
    this.nickname = this.nickname.trim();
    switch (this.deviceType) {
      case 'LIGHTHOUSE': {
        await this.lighthouseService.setDeviceNickname(this.lighthouseDevice!, this.nickname);
        await this.lighthouseService.ignoreDevice(this.lighthouseDevice!, this.ignoreLighthouse);
        break;
      }
      case 'OPENVR': {
        await this.openvr.setDeviceNickname(this.ovrDevice!, this.nickname);
        break;
      }
    }
    this.close();
  }

  get identifier() {
    switch (this.deviceType) {
      case 'LIGHTHOUSE': {
        return this.lighthouseDevice?.deviceName;
      }
      case 'OPENVR': {
        if (this.ovrDevice?.handleType) {
          return this.translate.instant(
            'comp.device-list.deviceRole.' + this.ovrDevice!.handleType
          );
        }
        return this.ovrDevice?.serialNumber
      }
      default: {
        // Should never happen
        return 'Unknown Device';
      }
    }
  }

  getDeviceId() {
    switch (this.deviceType) {
      case 'LIGHTHOUSE': {
        const model = this.translate.instant(
          'comp.device-list.deviceName.' + this.lighthouseDevice!.deviceType
        );
        return model + ' (' + this.identifier + ')';
      }
      case 'OPENVR': {
        return this.ovrDevice?.modelNumber + ' (' + this.identifier + ')';
      }
      default: {
        // Should never happen
        return 'Unknown Device';
      }
    }
  }
}
