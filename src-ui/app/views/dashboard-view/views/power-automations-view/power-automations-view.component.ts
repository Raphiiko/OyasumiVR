import { Component, OnInit } from '@angular/core';
import { noop } from '../../../../utils/animations';
import { firstValueFrom } from 'rxjs';
import { ActivatedRoute } from '@angular/router';

type PowerAutomationsTab = 'CONTROLLERS_AND_TRACKERS' | 'BASE_STATIONS' | 'WINDOWS_POWER_POLICY';
@Component({
  selector: 'app-power-automations-view',
  templateUrl: './power-automations-view.component.html',
  styleUrls: ['./power-automations-view.component.scss'],
  animations: [noop()],
})
export class PowerAutomationsViewComponent implements OnInit {
  activeTab: PowerAutomationsTab = 'CONTROLLERS_AND_TRACKERS';

  constructor(private activatedRoute: ActivatedRoute) {}
  async ngOnInit() {
    const fragment = await firstValueFrom(this.activatedRoute.fragment);
    if (fragment) this.activeTab = fragment as PowerAutomationsTab;
  }
}
