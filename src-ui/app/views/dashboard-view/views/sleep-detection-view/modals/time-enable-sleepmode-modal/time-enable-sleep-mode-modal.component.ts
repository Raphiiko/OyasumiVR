import { Component, HostBinding, OnInit } from '@angular/core';
import { BaseModalComponent } from 'src-ui/app/components/base-modal/base-modal.component';
import { fade, fadeUp, triggerChildren } from '../../../../../../utils/animations';

export interface TimeEnableSleepModeModalInputModel {
  time: string | null;
}

export interface TimeEnableSleepModeModalOutputModel {
  time: string | null;
}

@Component({
    selector: 'app-time-enable-sleepmode-modal',
    templateUrl: './time-enable-sleep-mode-modal.component.html',
    styleUrls: ['./time-enable-sleep-mode-modal.component.scss'],
    animations: [fadeUp(), fade(), triggerChildren()],
    standalone: false
})
export class TimeEnableSleepModeModalComponent
  extends BaseModalComponent<
    TimeEnableSleepModeModalInputModel,
    TimeEnableSleepModeModalOutputModel
  >
  implements OnInit, TimeEnableSleepModeModalInputModel
{
  time: string | null = null;

  @HostBinding('[@fadeUp]') get fadeUp() {
    return;
  }

  constructor() {
    super();
  }

  ngOnInit(): void {}

  save() {
    this.result = this;
    this.close();
  }
}
