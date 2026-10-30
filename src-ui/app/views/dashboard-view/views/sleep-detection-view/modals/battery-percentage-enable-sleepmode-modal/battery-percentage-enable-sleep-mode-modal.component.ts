import { Component, HostBinding, OnInit } from '@angular/core';
import { BaseModalComponent } from 'src-ui/app/components/base-modal/base-modal.component';
import { fade, fadeUp, triggerChildren, vshrink } from '../../../../../../utils/animations';
import { OVRDeviceClass } from '../../../../../../models/ovr-device';
import { AUTOMATION_CONFIGS_DEFAULT } from '../../../../../../models/automations';
import { TranslocoService } from '@jsverse/transloco';
import { uniq } from 'lodash';

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
  standalone: false,
})
export class BatteryPercentageEnableSleepModeModalComponent
  extends BaseModalComponent<
    BatteryPercentageEnableSleepModeModalInputModel,
    BatteryPercentageEnableSleepModeModalOutputModel
  >
  implements OnInit, BatteryPercentageEnableSleepModeModalInputModel
{
  readonly automationDefaults = AUTOMATION_CONFIGS_DEFAULT;
  triggerClasses: OVRDeviceClass[] = [];
  threshold = 0;

  @HostBinding('[@fadeUp]') get fadeUp() {
    return;
  }

  constructor(private translate: TranslocoService) {
    super();
  }

  ngOnInit(): void {}

  save() {
    this.result = {
      triggerClasses: uniq(this.triggerClasses),
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
