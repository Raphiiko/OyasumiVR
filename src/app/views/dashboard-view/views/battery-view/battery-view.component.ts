import { Component, OnInit } from '@angular/core';
import { noop } from '../../../../utils/animations';

@Component({
  selector: 'app-battery-view',
  templateUrl: './battery-view.component.html',
  styleUrls: ['./battery-view.component.scss'],
  animations: [noop()],
})
export class BatteryViewComponent implements OnInit {
  constructor() {}

  ngOnInit(): void {}
}
