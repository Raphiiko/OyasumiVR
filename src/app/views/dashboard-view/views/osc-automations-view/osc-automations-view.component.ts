import { Component, OnInit, ViewChild } from '@angular/core';
import { noop, vshrink } from '../../../../utils/animations';
import { SelectBoxItem } from '../../../../components/select-box/select-box.component';

@Component({
  selector: 'app-osc-automations-view',
  templateUrl: './osc-automations-view.component.html',
  styleUrls: ['./osc-automations-view.component.scss'],
  animations: [noop(), vshrink()],
})
export class OscAutomationsViewComponent implements OnInit {
  activeTab: 'SLEEPING_ANIMATIONS' = 'SLEEPING_ANIMATIONS';
  oscOptionsExpanded = true;
  oscPresetOptions: SelectBoxItem[] = [
    {
      id: 'GOGO_LOCO_1.7.0',
      label: 'GoGo Loco 1.7.0',
      subLabel: {
        string: 'oscAutomations.sleepingAnimations.presetAuthor',
        values: { author: 'franada' },
      },
      infoLink: 'https://booth.pm/en/items/3290806',
    },
    {
      id: 'MMM_SLEEP_SYSTEM_2.2',
      label: 'ごろ寝システム v2.2',
      subLabel: {
        string: 'oscAutomations.sleepingAnimations.presetAuthor',
        values: { author: 'んみんみーん' },
      },
      infoLink: 'https://booth.pm/ko/items/2886739',
    },
    {
      id: 'CUSTOM',
      label: 'Custom Animations',
    },
  ];

  constructor() {}

  ngOnInit(): void {}
}
