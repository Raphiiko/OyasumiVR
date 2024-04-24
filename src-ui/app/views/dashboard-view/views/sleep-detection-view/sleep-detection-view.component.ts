import { Component } from '@angular/core';

@Component({
  selector: 'app-sleep-detection-view',
  templateUrl: './sleep-detection-view.component.html',
  styleUrls: ['./sleep-detection-view.component.scss'],
  animations: [],
})
export class SleepDetectionViewComponent {
  activeTab: 'DETECTION' | 'ENABLE' | 'DISABLE' = 'DETECTION';

  constructor() {}
}
