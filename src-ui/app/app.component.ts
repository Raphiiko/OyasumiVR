import { Component, OnInit, ChangeDetectionStrategy } from '@angular/core';
import { OpenVRService } from './services/openvr.service';
import { routeAnimations } from './app-routing.module';
import { TranslocoService } from '@jsverse/transloco';
import { AppSettingsService } from './services/app-settings.service';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  debounceTime,
  distinctUntilChanged,
  map,
  Observable,
  of,
  skip,
  switchMap,
  tap,
} from 'rxjs';
import { fade } from './utils/animations';
import { TelemetryService } from './services/telemetry.service';
import { isHolidaysEventActive } from './utils/event-utils';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss'],
  animations: [routeAnimations, fade()],
  changeDetection: ChangeDetectionStrategy.Eager,
  standalone: false,
})
export class AppComponent implements OnInit {
  showSnowverlay = false;

  constructor(
    public openvr: OpenVRService,
    translate: TranslocoService,
    private settings: AppSettingsService,
    private telemetry: TelemetryService
  ) {
    this.settings.settings
      .pipe(
        map((settings) => settings.userLanguage),
        distinctUntilChanged(),
        // The translation has to be in memory before anything calls translate()
        // synchronously. A translation supplied at runtime, as the translation
        // editor's preview does, is already in memory but has no file to fetch,
        // so loading it would 404 and fall back to the fallback language.
        switchMap((userLanguage) => {
          const alreadyInMemory =
            Object.keys(translate.getTranslation(userLanguage) ?? {}).length > 0;
          const ready: Observable<unknown> = alreadyInMemory
            ? of(null)
            : translate.load(userLanguage);
          return ready.pipe(map(() => userLanguage));
        }),
        tap((userLanguage) => translate.setActiveLang(userLanguage)),
        debounceTime(10000),
        tap((userLanguage) =>
          this.telemetry.trackEvent('use_language', { language: userLanguage })
        ),
        takeUntilDestroyed()
      )
      .subscribe();
    // Snowverlay
    this.settings.settings
      .pipe(
        skip(1),
        map((settings) => settings.hideSnowverlay),
        distinctUntilChanged(),
        takeUntilDestroyed()
      )
      .subscribe((hideSnowverlay) => {
        this.showSnowverlay = !hideSnowverlay && isHolidaysEventActive();
      });
  }

  async ngOnInit(): Promise<void> {}
}
