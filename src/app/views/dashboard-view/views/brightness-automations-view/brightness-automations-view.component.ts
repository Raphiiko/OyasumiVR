import { Component, OnInit } from '@angular/core';
import { SelectBoxItem } from '../../../../components/select-box/select-box.component';
import { vshrink } from '../../../../utils/animations';

@Component({
  selector: 'app-brightness-automations-view',
  templateUrl: './brightness-automations-view.component.html',
  styleUrls: ['./brightness-automations-view.component.scss'],
  animations: [vshrink()],
})
export class BrightnessAutomationsViewComponent implements OnInit {
  transitionUnitOptions: SelectBoxItem[] = [
    {
      id: 'SECONDS',
      label: 'Seconds',
    },
    {
      id: 'MINUTES',
      label: 'Minutes',
    },
  ];
  transitionUnitOptionOnEnable?: SelectBoxItem = this.transitionUnitOptions[0];
  transitionUnitOptionOnDisable?: SelectBoxItem = this.transitionUnitOptions[0];

  constructor() {}

  ngOnInit(): void {}
}
