import { ChangeDetectionStrategy, Component } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AppSettingsService } from '../../../../../../services/app-settings.service';
import { APP_SETTINGS_DEFAULT, AppSettings } from '../../../../../../models/settings';

type Tweak = 'overlayGpuAcceleration' | 'openVrInitDelayFix' | 'lighthousePowerOffDelay';

@Component({
  selector: 'app-settings-troubleshooting-tweaks-tab',
  templateUrl: './settings-troubleshooting-tweaks-tab.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  standalone: false,
})
export class SettingsTroubleshootingTweaksTabComponent {
  settings: AppSettings = structuredClone(APP_SETTINGS_DEFAULT);

  constructor(private settingsService: AppSettingsService) {
    this.settingsService.settings
      .pipe(takeUntilDestroyed())
      .subscribe((settings) => (this.settings = settings));
  }

  isDefault(tweak: Tweak): boolean {
    return this.settings[tweak] === APP_SETTINGS_DEFAULT[tweak];
  }

  update(changes: Partial<AppSettings>) {
    this.settingsService.updateSettings(changes);
  }

  reset(tweak: Tweak) {
    this.update({ [tweak]: APP_SETTINGS_DEFAULT[tweak] });
  }
}
