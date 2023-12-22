import { Component, OnInit } from '@angular/core';
import { OpenVRService } from './services/openvr.service';
import { routeAnimations } from './app-routing.module';
import { TranslateService } from '@ngx-translate/core';
import { AppSettingsService } from './services/app-settings.service';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { distinctUntilChanged, map, skip } from 'rxjs';
import { fade } from './utils/animations';
import { TelemetryService } from './services/telemetry.service';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss'],
  animations: [routeAnimations, fade()],
})
export class AppComponent implements OnInit {
  showSnowverlay = false;

  constructor(
    public openvr: OpenVRService,
    translate: TranslateService,
    private settings: AppSettingsService,
    private telemetry: TelemetryService
  ) {
    this.settings.settings
      .pipe(
        takeUntilDestroyed(),
        map((settings) => settings.userLanguage),
        distinctUntilChanged()
      )
      .subscribe((userLanguage) => {
        translate.use(userLanguage);
        this.telemetry.trackEvent('use_language', { language: userLanguage });
      });
    // Snowverlay
    this.settings.settings
      .pipe(
        takeUntilDestroyed(),
        skip(1),
        map((settings) => settings.hideSnowverlay),
        distinctUntilChanged()
      )
      .subscribe((hideSnowverlay) => {
        const now = new Date();
        this.showSnowverlay = !hideSnowverlay && now.getMonth() === 11 && now.getDate() >= 18;
      });
  }

  async ngOnInit(): Promise<void> {}
}
