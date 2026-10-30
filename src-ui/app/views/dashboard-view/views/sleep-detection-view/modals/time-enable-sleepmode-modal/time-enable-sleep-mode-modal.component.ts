import { Component, HostBinding, OnInit } from '@angular/core';
import { AUTOMATION_CONFIGS_DEFAULT } from '../../../../../../models/automations';
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
  animations: [fadeUp(), fade(), triggerChildren()],
  standalone: false,
})
export class TimeEnableSleepModeModalComponent
  extends BaseModalComponent<
    TimeEnableSleepModeModalInputModel,
    TimeEnableSleepModeModalOutputModel
  >
  implements OnInit, TimeEnableSleepModeModalInputModel
{
  readonly automationDefaults = AUTOMATION_CONFIGS_DEFAULT;
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
