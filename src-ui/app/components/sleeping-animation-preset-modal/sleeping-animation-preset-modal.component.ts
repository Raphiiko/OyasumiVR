import { Component, OnInit } from '@angular/core';
import { BaseModalComponent } from 'src-ui/app/components/base-modal/base-modal.component';
import { SleepingAnimationPreset } from '../../models/sleeping-animation-presets';
import { open } from '@tauri-apps/plugin-shell';
import { fadeUp } from '../../utils/animations';

interface SleepingAnimationPresetModalInputModel {
  preset?: SleepingAnimationPreset;
}

@Component({
  selector: 'app-sleeping-animation-preset-modal',
  templateUrl: './sleeping-animation-preset-modal.component.html',
  styleUrls: ['./sleeping-animation-preset-modal.component.scss'],
  animations: [fadeUp()],
  standalone: false,
})
export class SleepingAnimationPresetModalComponent
  extends BaseModalComponent<SleepingAnimationPresetModalInputModel, void>
  implements OnInit, SleepingAnimationPresetModalInputModel
{
  preset?: SleepingAnimationPreset;

  constructor() {
    super();
  }

  ngOnInit(): void {}

  async openUrl(url: string) {
    await open(url);
  }
}
