import { Component, HostBinding, OnInit } from '@angular/core';
import { BaseModalComponent } from 'src-ui/app/components/base-modal/base-modal.component';
import { fade, fadeUp, triggerChildren, vshrink } from '../../../../../../utils/animations';
import { TranslateService } from '@ngx-translate/core';

export interface UprightPoseDisableSleepModeModalInputModel {
  duration: number;
}

export interface UprightPoseDisableSleepModeModalOutputModel {
  duration: number;
}

@Component({
    selector: 'app-upright-pose-disable-sleepmode-modal',
    templateUrl: './upright-pose-disable-sleep-mode-modal.component.html',
    styleUrls: ['./upright-pose-disable-sleep-mode-modal.component.scss'],
    animations: [vshrink(), fadeUp(), fade(), triggerChildren()],
    standalone: false
})
export class UprightPoseDisableSleepModeModalComponent
  extends BaseModalComponent<
    UprightPoseDisableSleepModeModalInputModel,
    UprightPoseDisableSleepModeModalOutputModel
  >
  implements OnInit, UprightPoseDisableSleepModeModalInputModel
{
  set duration(value: number) {
    this.durationInternal = Math.round(Math.min(59000, Math.max(value, 1000)) / 1000);
  }
  durationInternal = 0;

  @HostBinding('[@fadeUp]') get fadeUp() {
    return;
  }

  constructor(private translate: TranslateService) {
    super();
  }

  ngOnInit(): void {}

  save() {
    this.result = {
      duration: this.durationInternal * 1000,
    };
    this.close();
  }
}
