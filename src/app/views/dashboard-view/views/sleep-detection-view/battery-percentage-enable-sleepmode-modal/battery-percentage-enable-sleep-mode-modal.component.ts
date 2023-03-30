import { Component, HostBinding, OnInit } from '@angular/core';
import { SimpleModalComponent } from 'ngx-simple-modal';
import { fade, fadeUp, triggerChildren, vshrink } from '../../../../../utils/animations';
import { OVRDeviceClass } from '../../../../../models/ovr-device';
import { TranslateService } from '@ngx-translate/core';

export interface BatteryPercentageEnableSleepModeModalInputModel {
  triggerClasses: OVRDeviceClass[];
  threshold: number;
}

export interface BatteryPercentageEnableSleepModeModalOutputModel {
  triggerClasses: OVRDeviceClass[];
  threshold: number;
}

@Component({
  selector: 'app-battery-percentage-enable-sleepmode-modal',
  templateUrl: './battery-percentage-enable-sleep-mode-modal.component.html',
  styleUrls: ['./battery-percentage-enable-sleep-mode-modal.component.scss'],
  animations: [vshrink(), fadeUp(), fade(), triggerChildren()],
})
export class BatteryPercentageEnableSleepModeModalComponent
  extends SimpleModalComponent<
    BatteryPercentageEnableSleepModeModalInputModel,
    BatteryPercentageEnableSleepModeModalOutputModel
  >
  implements OnInit, BatteryPercentageEnableSleepModeModalInputModel
{
  triggerClasses: OVRDeviceClass[] = [];
  threshold = 0;

  @HostBinding('[@fadeUp]') get fadeUp() {
    return;
  }

  constructor(private translate: TranslateService) {
    super();
  }

  ngOnInit(): void {}

  save() {
    this.result = {
      triggerClasses: this.triggerClasses,
      threshold: this.threshold,
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
