import { Component, OnDestroy, OnInit } from '@angular/core';
import { noop } from '../../../../utils/animations';
import { SleepModeService } from '../../../../services/sleep-mode.service';
import { Subject, takeUntil } from 'rxjs';

@Component({
  selector: 'app-overview-view',
  templateUrl: './overview-view.component.html',
  styleUrls: ['./overview-view.component.scss'],
  animations: [noop()],
})
export class OverviewViewComponent implements OnInit, OnDestroy {
  destroy$: Subject<void> = new Subject<void>();
  sleepModeActive = false;
  constructor(private sleepModeService: SleepModeService) {}

  ngOnInit(): void {
    this.sleepModeService.sleepMode
      .pipe(takeUntil(this.destroy$))
      .subscribe((sleepModeActive) => (this.sleepModeActive = sleepModeActive));
  }

  setSleepMode(enabled: boolean) {
    if (enabled) {
      this.sleepModeService.enableSleepMode({ type: 'MANUAL' });
    } else {
      this.sleepModeService.disableSleepMode({ type: 'MANUAL' });
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
  }
}
