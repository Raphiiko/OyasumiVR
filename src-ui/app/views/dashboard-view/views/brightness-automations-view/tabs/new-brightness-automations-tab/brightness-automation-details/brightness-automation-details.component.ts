import { Component, EventEmitter, Output } from '@angular/core';
import { fade, fadeRight } from '../../../../../../../utils/animations';
import { BrightnessEventAutomationConfig } from '../../../../../../../models/automations';

@Component({
  selector: 'app-brightness-automation-details',
  templateUrl: './brightness-automation-details.component.html',
  styleUrls: ['./brightness-automation-details.component.scss'],
  animations: [fade(), fadeRight()],
})
export class BrightnessAutomationDetailsComponent {
  @Output() close = new EventEmitter<void>();
  // protected config: BrightnessEventAutomationConfig = ;
}
