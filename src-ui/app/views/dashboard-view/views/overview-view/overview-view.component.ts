import { Component, DestroyRef, OnInit } from '@angular/core';
import { fade, hshrink, noop } from '../../../../utils/animations';
import { SleepService } from '../../../../services/sleep.service';
import { OpenVRService } from '../../../../services/openvr.service';
import { OscService } from '../../../../services/osc.service';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { SleepPreparationService } from '../../../../services/sleep-preparation.service';
import { isHolidaysEventActive } from 'src-ui/app/utils/event-utils';

type IllustrationVariant = 'sleep' | 'peek' | 'awake' | 'awake-hover';

@Component({
  selector: 'app-overview-view',
  templateUrl: './overview-view.component.html',
  styleUrls: ['./overview-view.component.scss'],
  animations: [noop(), fade(), hshrink()],
  standalone: false,
})
export class OverviewViewComponent implements OnInit {
  sleepModeActive = false;
  illustrationPath: string | null = null;
  illustrationVariant: IllustrationVariant | null = null;
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
      this.determineIllustrationPath();
    });
  }

  async setSleepMode(enabled: boolean) {
    if (enabled) {
      await this.sleep.enableSleepMode({ type: 'MANUAL' });
    } else {
      await this.sleep.disableSleepMode({ type: 'MANUAL' });
    }
  }

  protected determineIllustrationPath(mouseover: boolean | null = null) {
    if (mouseover !== null) this.mouseover = mouseover;
    const tags = ['illustration'];

    if (isHolidaysEventActive()) tags.push('holidays');

    let variant: IllustrationVariant = 'awake';
    if (this.sleepModeActive) {
      variant = this.mouseover ? 'peek' : 'sleep';
    } else {
      variant = this.mouseover ? 'awake-hover' : 'awake';
    }
    tags.push(variant);

    this.illustrationVariant = variant;
    this.illustrationPath = `assets/img/${tags.join('_')}.png`;
  }
}
