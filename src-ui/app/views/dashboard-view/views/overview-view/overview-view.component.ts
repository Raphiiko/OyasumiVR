import { Component, DestroyRef, OnInit } from '@angular/core';
import { fade, hshrink, noop } from '../../../../utils/animations';
import { SleepService } from '../../../../services/sleep.service';
import { OpenVRService } from '../../../../services/openvr.service';
import { OscService } from '../../../../services/osc.service';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { SleepPreparationService } from '../../../../services/sleep-preparation.service';

@Component({
  selector: 'app-overview-view',
  templateUrl: './overview-view.component.html',
  styleUrls: ['./overview-view.component.scss'],
  animations: [noop(), fade(), hshrink()],
})
export class OverviewViewComponent implements OnInit {
  sleepModeActive = false;
  illustration: 'sleep' | 'peek' | 'awake' | 'awake-hover' | null = null;
  mouseover = false;

  constructor(
    private sleep: SleepService,
    public openvr: OpenVRService,
    public osc: OscService,
    private destroyRef: DestroyRef,
    protected sleepPreparation: SleepPreparationService
  ) {}

  ngOnInit(): void {
    this.sleep.mode.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((sleepModeActive) => {
      this.sleepModeActive = sleepModeActive;
      this.determineIllustration();
    });
  }

  async setSleepMode(enabled: boolean) {
    if (enabled) {
      await this.sleep.enableSleepMode({ type: 'MANUAL' });
    } else {
      await this.sleep.disableSleepMode({ type: 'MANUAL' });
    }
  }

  protected determineIllustration(mouseover: boolean | null = null) {
    if (mouseover !== null) this.mouseover = mouseover;
    if (this.sleepModeActive) {
      this.illustration = this.mouseover ? 'peek' : 'sleep';
    } else {
      this.illustration = this.mouseover ? 'awake-hover' : 'awake';
    }
  }
}
