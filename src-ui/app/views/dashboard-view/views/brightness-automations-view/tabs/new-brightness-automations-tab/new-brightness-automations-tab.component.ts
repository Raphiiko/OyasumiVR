import { Component } from '@angular/core';
import { BrightnessEvent } from '../../../../../../models/automations';
import { triggerChildren } from '../../../../../../utils/animations';

@Component({
  selector: 'app-new-brightness-automations-tab',
  templateUrl: './new-brightness-automations-tab.component.html',
  styleUrls: ['./new-brightness-automations-tab.component.scss'],
  animations: [triggerChildren()],
})
export class NewBrightnessAutomationsTabComponent {
  protected editEvent?: BrightnessEvent = 'SLEEP_MODE_ENABLE';
  // protected editEvent?: BrightnessEvent;
}
