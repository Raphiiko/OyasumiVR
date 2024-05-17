import { Component, HostBinding, OnInit } from '@angular/core';
import { BaseModalComponent } from 'src-ui/app/components/base-modal/base-modal.component';
import { fade, fadeUp, triggerChildren, vshrink } from '../../../../../../utils/animations';
import { TranslateService } from '@ngx-translate/core';
import { getStringForDuration } from '../../tabs/sleep-detection-tab.component';

export interface DurationDisableSleepModeModalInputModel {
  duration: string | null;
}

export interface DurationDisableSleepModeModalOutputModel {
  duration: string | null;
}

@Component({
  selector: 'app-duration-disable-sleepmode-modal',
  templateUrl: './duration-disable-sleep-mode-modal.component.html',
  styleUrls: ['./duration-disable-mode-modal.component.scss'],
  animations: [fadeUp(), fade(), triggerChildren(), vshrink()],
})
export class DurationDisableSleepModeModalComponent
  extends BaseModalComponent<
    DurationDisableSleepModeModalInputModel,
    DurationDisableSleepModeModalOutputModel
  >
  implements OnInit, DurationDisableSleepModeModalInputModel
{
  duration: string | null = null;

  @HostBinding('[@fadeUp]') get fadeUp() {
    return;
  }

  constructor(private translate: TranslateService) {
    super();
  }

  ngOnInit(): void {}

  save() {
    this.result = this;
    this.close();
  }

  protected getStringForDuration(duration: string | null) {
    if (!duration) {
      return '';
    }
    return getStringForDuration(this.translate, duration);
  }
}
