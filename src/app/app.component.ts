import { Component, OnInit } from '@angular/core';
import { OpenVRService } from './services/openvr.service';
import { routeAnimations } from './app-routing.module';
import { TranslateService } from '@ngx-translate/core';
import { AppSettingsService } from './services/app-settings.service';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { interval } from 'rxjs';
import { invoke } from '@tauri-apps/api';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss'],
  animations: [routeAnimations],
})
export class AppComponent implements OnInit {
  constructor(
    public openvr: OpenVRService,
    private translate: TranslateService,
    private settings: AppSettingsService
  ) {
    this.settings.settings.pipe(takeUntilDestroyed()).subscribe((settings) => {
      translate.use(settings.userLanguage);
    });
  }

  async ngOnInit(): Promise<void> {
    // interval(32).subscribe(() => {
    //   const brightness = Math.sin(Date.now() / 250.0) / 2.0 + 0.5;
    //   invoke('openvr_set_image_brightness', { brightness });
    // });
  }
}
