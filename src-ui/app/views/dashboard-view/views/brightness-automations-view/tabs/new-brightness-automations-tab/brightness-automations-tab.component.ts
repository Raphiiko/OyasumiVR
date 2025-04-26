import { Component, DestroyRef, OnDestroy, OnInit } from '@angular/core';
import { BrightnessEvent } from '../../../../../../models/automations';
import { triggerChildren } from '../../../../../../utils/animations';
import { AppSettingsService } from '../../../../../../services/app-settings.service';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { filter } from 'rxjs';
import KonamiCode from 'konami-code-js';

export interface BrightnessEventViewModel {
  name: BrightnessEvent;
  inProgress: boolean;
  icon: string;
  iconFilled?: boolean;
  sunMode?: 'SUNSET' | 'SUNRISE';
}

@Component({
  selector: 'app-brightness-automations-tab',
  templateUrl: './brightness-automations-tab.component.html',
  styleUrls: ['./brightness-automations-tab.component.scss'],
  animations: [triggerChildren()],
  standalone: false,
})
export class BrightnessAutomationsTabComponent implements OnInit, OnDestroy {
  protected editEvent?: BrightnessEventViewModel;

  protected events: Array<BrightnessEventViewModel> = [
    { name: 'SLEEP_MODE_ENABLE', inProgress: false, icon: 'bedtime' },
    { name: 'SLEEP_MODE_DISABLE', inProgress: false, icon: 'bedtime_off' },
    { name: 'SLEEP_PREPARATION', inProgress: false, icon: 'bed' },
    { name: 'AT_SUNSET', inProgress: false, icon: 'wb_twilight', sunMode: 'SUNSET' },
    {
      name: 'AT_SUNRISE',
      inProgress: false,
      icon: 'wb_twilight',
      iconFilled: true,
      sunMode: 'SUNRISE',
    },
  ];

  private konami: KonamiCode | undefined;

  constructor(private appSettings: AppSettingsService, private destroyRef: DestroyRef) {}

  ngOnInit() {
    this.appSettings
      .oneTimeFlagSetAsync('BRIGHTNESS_AUTOMATION_ON_HMD_CONNECT_EVENT_FEATURE')
      .pipe(takeUntilDestroyed(this.destroyRef), filter(Boolean))
      .subscribe(() => {
        this.events.push({ name: 'HMD_CONNECT', inProgress: false, icon: 'head_mounted_device' });
      });

    this.konami = new KonamiCode(() => {
      this.konami?.disable();
      this.appSettings.setOneTimeFlag('BRIGHTNESS_AUTOMATION_ON_HMD_CONNECT_EVENT_FEATURE');
    });
  }

  ngOnDestroy() {
    this.konami?.disable();
  }
}
