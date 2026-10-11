import { ChangeDetectionStrategy, Component } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AppSettingsService } from '../../../../../../services/app-settings.service';
import { APP_SETTINGS_DEFAULT, AppSettings } from '../../../../../../models/settings';

const TWEAKS = ['overlayGpuAcceleration', 'openVrInitDelayFix', 'lighthousePowerOffDelay'] as const;
type Tweak = (typeof TWEAKS)[number];

@Component({
  selector: 'app-settings-troubleshooting-tweaks-tab',
  templateUrl: './settings-troubleshooting-tweaks-tab.component.html',
  styleUrls: ['./settings-troubleshooting-tweaks-tab.component.scss'],
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

  get allDefault(): boolean {
    return TWEAKS.every((tweak) => this.isDefault(tweak));
  }

  isDefault(tweak: Tweak): boolean {
    return this.settings[tweak] === APP_SETTINGS_DEFAULT[tweak];
  }

  update(changes: Partial<AppSettings>) {
    this.settingsService.updateSettings(changes);
  }

  reset(tweaks: readonly Tweak[]) {
    this.update(Object.fromEntries(tweaks.map((tweak) => [tweak, APP_SETTINGS_DEFAULT[tweak]])));
  }

  resetAll() {
    this.reset(TWEAKS);
  }
}
