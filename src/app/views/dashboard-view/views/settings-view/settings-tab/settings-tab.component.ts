import { Component, OnDestroy, OnInit } from '@angular/core';
import { APP_SETTINGS_DEFAULT, AppSettings } from '../../../../../models/settings';
import { cloneDeep } from 'lodash';
import { Subject, takeUntil } from 'rxjs';
import { AppSettingsService } from '../../../../../services/app-settings.service';

@Component({
  selector: 'app-settings-tab',
  templateUrl: './settings-tab.component.html',
  styleUrls: ['./settings-tab.component.scss'],
})
export class SettingsTabComponent implements OnInit, OnDestroy {
  destroy$: Subject<void> = new Subject<void>();
  appSettings: AppSettings = cloneDeep(APP_SETTINGS_DEFAULT);

  constructor(protected settingsService: AppSettingsService) {}

  ngOnInit() {
    this.settingsService.settings.pipe(takeUntil(this.destroy$)).subscribe((appSettings) => {
      this.appSettings = appSettings;
    });
  }

  ngOnDestroy() {
    this.destroy$.next();
  }
}
