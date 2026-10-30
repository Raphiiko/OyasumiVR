import { Component } from '@angular/core';
import { BaseModalComponent } from 'src-ui/app/components/base-modal/base-modal.component';
import { fadeUp } from 'src-ui/app/utils/animations';

@Component({
  selector: 'app-elevation-prompt-scene-modal',
  templateUrl: './elevation-prompt-scene-modal.component.html',
  styleUrls: ['./elevation-prompt-scene-modal.component.scss'],
  animations: [fadeUp()],
  standalone: false,
})
export class ElevationPromptSceneModalComponent extends BaseModalComponent<void, void> {}
