import { Component, HostBinding, OnInit } from '@angular/core';
import { BaseModalComponent } from 'src-ui/app/components/base-modal/base-modal.component';
import { fade, fadeUp, triggerChildren } from '../../../../../../utils/animations';
import { OVRDeviceClass } from '../../../../../../models/ovr-device';

export interface DevicePowerOnDisableSleepModeModalInputModel {
  triggerClasses: OVRDeviceClass[];
}

export interface DevicePowerOnDisableSleepModeModalOutputModel {
  triggerClasses: OVRDeviceClass[];
}

@Component({
    selector: 'app-device-power-on-disable-sleepmode-modal',
    templateUrl: './device-power-on-disable-sleep-mode-modal.component.html',
    styleUrls: ['./device-power-on-disable-sleep-mode-modal.component.scss'],
    animations: [fadeUp(), fade(), triggerChildren()],
    standalone: false
})
export class DevicePowerOnDisableSleepModeModalComponent
  extends BaseModalComponent<
    DevicePowerOnDisableSleepModeModalInputModel,
    DevicePowerOnDisableSleepModeModalOutputModel
  >
  implements OnInit, DevicePowerOnDisableSleepModeModalInputModel
{
  triggerClasses: OVRDeviceClass[] = [];

  @HostBinding('[@fadeUp]') get fadeUp() {
    return;
  }

  constructor() {
    super();
  }

  ngOnInit(): void {}

  save() {
    this.result = {
      triggerClasses: this.triggerClasses,
    };
    this.close();
  }

  toggleClass(deviceClass: OVRDeviceClass) {
    if (this.triggerClasses.includes(deviceClass)) {
      this.triggerClasses = this.triggerClasses.filter((c) => c !== deviceClass);
    } else {
      this.triggerClasses.push(deviceClass);
    }
  }
}
