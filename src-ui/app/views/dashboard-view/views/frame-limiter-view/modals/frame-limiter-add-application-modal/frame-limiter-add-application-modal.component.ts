import { Component, HostBinding, OnInit } from '@angular/core';
import { BaseModalComponent } from 'src-ui/app/components/base-modal/base-modal.component';
import { fade, fadeUp, triggerChildren } from 'src-ui/app/utils/animations';
import {
  FrameLimiterAppPreset,
  FrameLimiterPresets,
} from 'src-ui/app/services/frame-limiter.service';

export interface FrameLimiterAddApplicationModalInputModel {
  // Input properties can be added here if needed
}

export interface FrameLimiterAddApplicationModalOutputModel {
  appId?: number;
}

@Component({
  selector: 'app-frame-limiter-add-application-modal',
  templateUrl: './frame-limiter-add-application-modal.component.html',
  styleUrls: ['./frame-limiter-add-application-modal.component.scss'],
  animations: [fadeUp(), fade(), triggerChildren()],
  standalone: false,
})
export class FrameLimiterAddApplicationModalComponent
  extends BaseModalComponent<
    FrameLimiterAddApplicationModalInputModel,
    FrameLimiterAddApplicationModalOutputModel
  >
  implements OnInit
{
  // Making the presets available in the template
  public appPresets: FrameLimiterAppPreset[] = FrameLimiterPresets;

  @HostBinding('[@fadeUp]') get fadeUp() {
    return;
  }

  constructor() {
    super();
  }

  ngOnInit(): void {}

  // Method to select an application
  selectApp(appId: number): void {
    this.result = { appId };
    this.close();
  }
}
