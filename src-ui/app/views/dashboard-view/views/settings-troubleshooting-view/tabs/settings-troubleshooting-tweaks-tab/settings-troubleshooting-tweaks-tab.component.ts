import { ChangeDetectionStrategy, Component } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AppSettingsService } from '../../../../../../services/app-settings.service';

@Component({
  selector: 'app-settings-troubleshooting-tweaks-tab',
  templateUrl: './settings-troubleshooting-tweaks-tab.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  standalone: false,
})
export class SettingsTroubleshootingTweaksTabComponent {
  overlayGpuAcceleration = true;
  openVrInitDelayFix = false;
  lighthousePowerOffDelay = false;

  constructor(private settingsService: AppSettingsService) {
    this.settingsService.settings.pipe(takeUntilDestroyed()).subscribe((settings) => {
      this.overlayGpuAcceleration = settings.overlayGpuAcceleration;
      this.openVrInitDelayFix = settings.openVrInitDelayFix;
      this.lighthousePowerOffDelay = settings.lighthousePowerOffDelay;
    });
  }

  setOverlayGpuAcceleration(enabled: boolean) {
    this.settingsService.updateSettings({ overlayGpuAcceleration: enabled });
  }

  setOpenVrInitDelayFix(enabled: boolean) {
    this.settingsService.updateSettings({ openVrInitDelayFix: enabled });
  }

  setLighthousePowerOffDelay(enabled: boolean) {
    this.settingsService.updateSettings({ lighthousePowerOffDelay: enabled });
  }
}
