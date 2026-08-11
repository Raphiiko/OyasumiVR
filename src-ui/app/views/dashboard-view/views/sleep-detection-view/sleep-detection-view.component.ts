import { Component, ChangeDetectionStrategy } from '@angular/core';

@Component({
  selector: 'app-sleep-detection-view',
  templateUrl: './sleep-detection-view.component.html',
  styleUrls: ['./sleep-detection-view.component.scss'],
  animations: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false,
})
export class SleepDetectionViewComponent {
  activeTab: 'DETECTION' | 'ENABLE' | 'DISABLE' = 'DETECTION';

  constructor() {}
}
