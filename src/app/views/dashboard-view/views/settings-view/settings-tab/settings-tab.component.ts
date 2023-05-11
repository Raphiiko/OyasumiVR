import { Component, DestroyRef, inject, OnInit } from '@angular/core';
import { APP_SETTINGS_DEFAULT, AppSettings } from '../../../../../models/settings';
import { cloneDeep } from 'lodash';
import { AppSettingsService } from '../../../../../services/app-settings.service';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

@Component({
  selector: 'app-settings-tab',
  templateUrl: './settings-tab.component.html',
  styleUrls: ['./settings-tab.component.scss'],
})
export class SettingsTabComponent implements OnInit {
  protected appSettings: AppSettings = cloneDeep(APP_SETTINGS_DEFAULT);
  protected destroyRef: DestroyRef = inject(DestroyRef);

  constructor(protected settingsService: AppSettingsService) {}

  ngOnInit() {
    this.settingsService.settings
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((appSettings) => {
        this.appSettings = appSettings;
      });
  }
}
