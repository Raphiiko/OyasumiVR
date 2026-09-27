import { Component, OnInit, ChangeDetectionStrategy } from '@angular/core';
import { BrightnessEvent } from '../../../../../../models/automations';
import { triggerChildren } from '../../../../../../utils/animations';

export interface BrightnessEventViewModel {
  name: BrightnessEvent;
  inProgress: boolean;
  icon: string;
  sunMode?: 'SUNSET' | 'SUNRISE';
}

@Component({
  selector: 'app-brightness-automations-tab',
  templateUrl: './brightness-automations-tab.component.html',
  styleUrls: ['./brightness-automations-tab.component.scss'],
  animations: [triggerChildren()],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false,
})
export class BrightnessAutomationsTabComponent implements OnInit {
  protected editEvent?: BrightnessEventViewModel;

  protected events: Array<BrightnessEventViewModel> = [
    { name: 'SLEEP_MODE_ENABLE', inProgress: false, icon: 'sleep' },
    { name: 'SLEEP_MODE_DISABLE', inProgress: false, icon: 'sleep-off' },
    { name: 'SLEEP_PREPARATION', inProgress: false, icon: 'bed' },
    { name: 'AT_SUNSET', inProgress: false, icon: 'twilight', sunMode: 'SUNSET' },
    {
      name: 'AT_SUNRISE',
      inProgress: false,
      icon: 'twilight',
      sunMode: 'SUNRISE',
    },
    { name: 'HMD_CONNECT', inProgress: false, icon: 'headset' },
  ];

  constructor() {}

  ngOnInit() {}
}
