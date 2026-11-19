import { Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { APP_SETTINGS_DEFAULT } from 'src-ui/app/models/settings';
import { AppSettingsService } from 'src-ui/app/services/app-settings.service';

/** The fan settings of a Bigscreen Beyond's device page, which apply to every Beyond. */
@Component({
  selector: 'app-beyond-fan-settings',
  templateUrl: './beyond-fan-settings.component.html',
  standalone: false,
  // the host is the category, so the global sibling margin between categories applies to it
  host: { class: 'setting-category', style: 'display: block' },
})
export class BeyondFanSettingsComponent {
  private readonly appSettingsService = inject(AppSettingsService);
  protected readonly settings = toSignal(this.appSettingsService.settings, {
    initialValue: this.appSettingsService.settingsSync,
  });
  protected readonly defaults = APP_SETTINGS_DEFAULT;

  toggleSafeFanSpeed() {
    this.appSettingsService.updateSettings({
      bigscreenBeyondAllowUnsafeFanSpeed: !this.settings().bigscreenBeyondAllowUnsafeFanSpeed,
    });
  }

  toggleFanSafety() {
    this.appSettingsService.updateSettings({
      bigscreenBeyondBrightnessFanSafety: !this.settings().bigscreenBeyondBrightnessFanSafety,
    });
  }
}
