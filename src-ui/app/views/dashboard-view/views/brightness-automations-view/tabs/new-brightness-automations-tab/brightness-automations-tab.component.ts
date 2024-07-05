import { Component } from '@angular/core';
import { BrightnessEvent } from '../../../../../../models/automations';
import { triggerChildren } from '../../../../../../utils/animations';

@Component({
  selector: 'app-brightness-automations-tab',
  templateUrl: './brightness-automations-tab.component.html',
  styleUrls: ['./brightness-automations-tab.component.scss'],
  animations: [triggerChildren()],
})
export class BrightnessAutomationsTabComponent {
  protected editEvent?: BrightnessEvent;
}
