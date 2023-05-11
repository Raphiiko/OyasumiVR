import { Component, DestroyRef, OnInit } from '@angular/core';
import { noop } from '../../../../utils/animations';
import { SleepService } from '../../../../services/sleep.service';
import { filter, map, tap } from 'rxjs';
import { OpenVRService } from '../../../../services/openvr.service';
import { OscService } from '../../../../services/osc.service';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

@Component({
  selector: 'app-overview-view',
  templateUrl: './overview-view.component.html',
  styleUrls: ['./overview-view.component.scss'],
  animations: [noop()],
})
export class OverviewViewComponent implements OnInit {
  sleepModeActive = false;
  quaternion: [number, number, number, number] = [0, 0, 0, 0];

  constructor(
    private sleep: SleepService,
    public openvr: OpenVRService,
    public osc: OscService,
    private destroyRef: DestroyRef
  ) {}

  ngOnInit(): void {
    this.sleep.mode
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((sleepModeActive) => (this.sleepModeActive = sleepModeActive));
    this.openvr.devicePoses
      .pipe(
        takeUntilDestroyed(this.destroyRef),
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
}
