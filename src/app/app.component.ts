import { Component, OnDestroy, OnInit } from '@angular/core';
import { OpenVRService } from './services/openvr.service';
import { routeAnimations } from './app-routing.module';
import { TranslateService } from '@ngx-translate/core';
import { AppSettingsService } from './services/app-settings.service';
import { Subject, takeUntil } from 'rxjs';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss'],
  animations: [routeAnimations],
})
export class AppComponent implements OnInit, OnDestroy {
  private destroy$: Subject<void> = new Subject<void>();

  constructor(
    public openvr: OpenVRService,
    private translate: TranslateService,
    private settings: AppSettingsService
  ) {
    this.settings.settings.pipe(takeUntil(this.destroy$)).subscribe((settings) => {
      translate.use(settings.userLanguage);
    });
  }

  async ngOnInit(): Promise<void> {}

  ngOnDestroy() {
    this.destroy$.next();
  }
}
