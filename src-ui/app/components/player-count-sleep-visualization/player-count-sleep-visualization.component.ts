import { Component, Input } from '@angular/core';
import { hshrink } from '../../utils/animations';

@Component({
  selector: 'app-player-count-sleep-visualization',
  templateUrl: './player-count-sleep-visualization.component.html',
  styleUrls: ['./player-count-sleep-visualization.component.scss'],
  animations: [hshrink()],
})
export class PlayerCountSleepVisualizationComponent {
  @Input() public count = 0;
  @Input() public visualMax = 10;
  @Input() public style: 'NORMAL' | 'SMALL' = 'NORMAL';

  get bedLimit(): number {
    return Math.min(this.count, this.visualMax);
  }
}
