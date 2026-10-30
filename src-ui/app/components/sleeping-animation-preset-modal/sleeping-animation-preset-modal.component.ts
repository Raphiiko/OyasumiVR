import { Component, OnInit, inject } from '@angular/core';
import { BaseModalComponent } from 'src-ui/app/components/base-modal/base-modal.component';
import { SleepingAnimationPreset } from '../../models/sleeping-animation-presets';
import { ExternalLinkService } from '../../services/external-link.service';
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
  private externalLink = inject(ExternalLinkService);

  constructor() {
    super();
  }

  ngOnInit(): void {}

  async openUrl(url: string) {
    await this.externalLink.open(url);
  }
}
