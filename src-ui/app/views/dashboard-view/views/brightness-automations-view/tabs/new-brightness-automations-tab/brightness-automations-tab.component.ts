import { Component } from '@angular/core';
import { BrightnessEvent } from '../../../../../../models/automations';
import { triggerChildren } from '../../../../../../utils/animations';

export interface BrightnessEventViewModel {
  name: BrightnessEvent;
  inProgress: boolean;
  icon: string;
  iconFilled?: boolean;
  sunMode?: 'SUNSET' | 'SUNRISE';
}

@Component({
  selector: 'app-brightness-automations-tab',
  templateUrl: './brightness-automations-tab.component.html',
  styleUrls: ['./brightness-automations-tab.component.scss'],
  animations: [triggerChildren()],
})
export class BrightnessAutomationsTabComponent {
  protected editEvent?: BrightnessEventViewModel;

  protected events: Array<BrightnessEventViewModel> = [
    { name: 'SLEEP_MODE_ENABLE', inProgress: false, icon: 'bedtime' },
    { name: 'SLEEP_MODE_DISABLE', inProgress: false, icon: 'bedtime_off' },
    { name: 'SLEEP_PREPARATION', inProgress: false, icon: 'bed' },
    { name: 'AT_SUNSET', inProgress: false, icon: 'wb_twilight', sunMode: 'SUNSET' },
    {
      name: 'AT_SUNRISE',
      inProgress: false,
      icon: 'wb_twilight',
      iconFilled: true,
      sunMode: 'SUNRISE',
    },
  ];
}
