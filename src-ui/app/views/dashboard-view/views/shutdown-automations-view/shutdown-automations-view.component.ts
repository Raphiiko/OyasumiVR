import { Component, OnInit } from '@angular/core';

@Component({
    selector: 'app-shutdown-automations-view',
    templateUrl: './shutdown-automations-view.component.html',
    styleUrls: ['./shutdown-automations-view.component.scss'],
    standalone: false
})
export class ShutdownAutomationsViewComponent implements OnInit {
  protected activeTab: 'SETTINGS' | 'TRIGGERS' = 'SETTINGS';

  constructor() {}

  ngOnInit() {}
}
