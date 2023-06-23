import { Component } from '@angular/core';

@Component({
  selector: 'app-brightness-automations-view',
  templateUrl: './brightness-automations-view.component.html',
  styleUrls: ['./brightness-automations-view.component.scss'],
})
export class BrightnessAutomationsViewComponent {
  activeTab: 'IMAGE_BRIGHTNESS' | 'DISPLAY_BRIGHTNESS' = 'IMAGE_BRIGHTNESS';

  constructor() {}
}
