import { Component, DestroyRef, OnInit, ChangeDetectionStrategy } from '@angular/core';
import { AppSettingsService } from 'src-ui/app/services/app-settings.service';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { APP_SETTINGS_DEFAULT, AppSettings, VRCXEventLogType } from 'src-ui/app/models/settings';

@Component({
  selector: 'app-settings-integrations-vrcx-tab',
  templateUrl: './settings-integrations-vrcx-tab.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  standalone: false,
})
export class SettingsIntegrationsVrcxTabComponent implements OnInit {
  vrcxLogOptions: { type: VRCXEventLogType; key: string }[] = [
    { type: 'SleepMode', key: 'settings.integrations.vrcx.sleepModeChanges' },
    { type: 'Invites', key: 'settings.integrations.vrcx.invites' },
    { type: 'StatusChanges', key: 'settings.integrations.vrcx.statusChanges' },
    { type: 'GroupChanges', key: 'settings.integrations.vrcx.groupChanges' },
  ];
  appSettings: AppSettings = structuredClone(APP_SETTINGS_DEFAULT);

  constructor(
    private settingsService: AppSettingsService,
    private destroyRef: DestroyRef
  ) {}

  ngOnInit(): void {
    this.settingsService.settings
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((settings) => (this.appSettings = settings));
  }

  protected toggleVrcxLog(type: VRCXEventLogType) {
    const enabled = this.appSettings.vrcxLogsEnabled;
    this.settingsService.updateSettings({
      vrcxLogsEnabled: enabled.includes(type)
        ? enabled.filter((e) => e !== type)
        : [...enabled, type],
    });
  }
}
