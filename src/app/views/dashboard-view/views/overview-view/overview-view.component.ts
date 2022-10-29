import { Component, OnDestroy, OnInit } from '@angular/core';
import { noop } from '../../../../utils/animations';
import { SleepService } from '../../../../services/sleep.service';
import { filter, map, Subject, takeUntil, tap } from 'rxjs';
import { OpenVRService } from '../../../../services/openvr.service';
import { OscService } from '../../../../services/osc.service';

@Component({
  selector: 'app-overview-view',
  templateUrl: './overview-view.component.html',
  styleUrls: ['./overview-view.component.scss'],
  animations: [noop()],
})
export class OverviewViewComponent implements OnInit, OnDestroy {
  destroy$: Subject<void> = new Subject<void>();
  sleepModeActive = false;
  wew = false;
  quaternion: [number, number, number, number] = [0, 0, 0, 0];
  credentials: any = {};

  constructor(private sleep: SleepService, public openvr: OpenVRService, public osc: OscService) {}

  ngOnInit(): void {
    this.sleep.mode
      .pipe(takeUntil(this.destroy$))
      .subscribe((sleepModeActive) => (this.sleepModeActive = sleepModeActive));
    this.openvr.devicePoses
      .pipe(
        takeUntil(this.destroy$),
        map((poses) => poses[0]),
        filter((p) => !!p),
        tap((pose) => (this.quaternion = pose.quaternion))
      )
      .subscribe();
  }

  async setSleepMode(enabled: boolean) {
    if (enabled) {
      await this.sleep.enableSleepMode({ type: 'MANUAL' });
    } else {
      await this.sleep.disableSleepMode({ type: 'MANUAL' });
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
  }
}
