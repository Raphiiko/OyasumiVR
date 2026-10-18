import { Component, ChangeDetectionStrategy, input } from '@angular/core';
import { hshrink } from '../../utils/animations';

@Component({
  selector: 'app-player-count-sleep-visualization',
  templateUrl: './player-count-sleep-visualization.component.html',
  styleUrls: ['./player-count-sleep-visualization.component.scss'],
  animations: [hshrink()],
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: false,
})
export class PlayerCountSleepVisualizationComponent {
  public readonly count = input(0);
  public readonly visualMax = input(10);
  public readonly style = input<'NORMAL' | 'SMALL'>('NORMAL');

  get bedLimit(): number {
    return Math.min(this.count(), this.visualMax());
  }
}
