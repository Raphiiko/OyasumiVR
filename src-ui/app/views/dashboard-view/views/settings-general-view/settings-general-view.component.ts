import { Component, DestroyRef, OnInit, ChangeDetectionStrategy } from '@angular/core';
import { debounceTime, distinctUntilChanged, filter, Subject } from 'rxjs';
import {
  APP_SETTINGS_DEFAULT,
  AppSettings,
  ExecutableReferenceStatus,
} from 'src-ui/app/models/settings';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { SelectBoxItem } from 'src-ui/app/components/select-box/select-box.component';
import { LighthouseDevicePowerState } from 'src-ui/app/models/lighthouse-device';
import { SegmentedControlItem } from 'src-ui/app/components/segmented-control/segmented-control.component';
import { OpenVRService } from 'src-ui/app/services/openvr.service';
import { TelemetryService } from 'src-ui/app/services/telemetry/telemetry.service';
import { LighthouseConsoleService } from 'src-ui/app/services/lighthouse-console.service';
import { AppSettingsService } from 'src-ui/app/services/app-settings.service';
import { ElevatedSidecarService } from 'src-ui/app/services/elevated-sidecar.service';
import { FileDialogService } from 'src-ui/app/services/file-dialog.service';

import { LANGUAGES } from '../../../../globals';
import { vshrink } from '../../../../utils/animations';
import { flushOnDestroy } from '../../../../utils/rxjs-utils';
import {
  TELEMETRY_SETTINGS_DEFAULT,
  TelemetrySettings,
} from '../../../../models/telemetry-settings';
import { OVRInputEventAction } from 'src-ui/app/models/ovr-input-event';

@Component({
  selector: 'app-settings-general-view',
  templateUrl: './settings-general-view.component.html',
  styleUrls: ['./settings-general-view.component.scss'],
  animations: [vshrink()],
  changeDetection: ChangeDetectionStrategy.Eager,
  standalone: false,
})
export class SettingsGeneralViewComponent implements OnInit {
  readonly defaults = APP_SETTINGS_DEFAULT;
  readonly telemetryDefaults = TELEMETRY_SETTINGS_DEFAULT;
  appSettings: AppSettings = structuredClone(APP_SETTINGS_DEFAULT);
  languages = LANGUAGES;
  lighthouseConsoleStatus: ExecutableReferenceStatus = 'UNKNOWN';
  lighthouseConsolePathAlert?: {
    text: string;
    type: 'INFO' | 'SUCCESS' | 'ERROR';
    loadingIndicator?: boolean;
  };
  lighthouseConsolePathInputChange: Subject<string | null> = new Subject();
  telemetrySettings: TelemetrySettings = structuredClone(TELEMETRY_SETTINGS_DEFAULT);
  readonly lighthousePowerOffStates: SegmentedControlItem<LighthouseDevicePowerState>[] = [
    { id: 'sleep', label: 'settings.general.lighthousePowerControl.powerOffMode.sleep.title' },
    { id: 'standby', label: 'settings.general.lighthousePowerControl.powerOffMode.standby.title' },
  ];
  sleepModeStartupBehaviourOptions: SelectBoxItem[] = [
    {
      id: 'PERSIST',
      label: 'settings.general.sleepMode.startupBehaviour.option.persist.title',
      subLabel: 'settings.general.sleepMode.startupBehaviour.option.persist.description',
    },
    {
      id: 'ACTIVE',
      label: 'settings.general.sleepMode.startupBehaviour.option.enabled.title',
      subLabel: 'settings.general.sleepMode.startupBehaviour.option.enabled.description',
    },
    {
      id: 'INACTIVE',
      label: 'settings.general.sleepMode.startupBehaviour.option.disabled.title',
      subLabel: 'settings.general.sleepMode.startupBehaviour.option.disabled.description',
    },
  ];
  sleepModeStartupBehaviourOption: SelectBoxItem | undefined;
  constructor(
    private lighthouse: LighthouseConsoleService,
    private telemetry: TelemetryService,
    private destroyRef: DestroyRef,
    private settingsService: AppSettingsService,
    private openvr: OpenVRService,
    protected elevatedSidecar: ElevatedSidecarService,
    private fileDialog: FileDialogService
  ) {}

  ngOnInit(): void {
    this.settingsService.settings
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((settings) => (this.appSettings = settings));
    this.lighthouse.consoleStatus
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((status) => this.processLighthouseConsoleStatus(status));
    flushOnDestroy(this.lighthouseConsolePathInputChange, this.destroyRef);
    this.lighthouseConsolePathInputChange
      .pipe(
        distinctUntilChanged(),
        debounceTime(500),
        filter((path): path is string => path !== null),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(async (path) => {
        await this.lighthouse.setConsolePath(path);
      });
    this.telemetry.settings
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((telemetrySettings) => {
        this.telemetrySettings = telemetrySettings;
      });
    this.settingsService.settings
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((settings) => {
        this.sleepModeStartupBehaviourOption = this.sleepModeStartupBehaviourOptions.find(
          (o) => o.id === settings.sleepModeStartupBehaviour
        );
      });
  }

  setUserLanguage(languageCode: string) {
    this.settingsService.updateSettings({ userLanguage: languageCode });
  }

  processLighthouseConsoleStatus(status: ExecutableReferenceStatus) {
    this.lighthouseConsoleStatus = status;
    const statusToAlertType: {
      [s: string]: 'INFO' | 'SUCCESS' | 'ERROR';
    } = { CHECKING: 'INFO', SUCCESS: 'SUCCESS' };
    this.lighthouseConsolePathAlert = [
      'NOT_FOUND',
      'INVALID_EXECUTABLE',
      'PERMISSION_DENIED',
      'INVALID_FILENAME',
      'UNKNOWN_ERROR',
      'CHECKING',
      'SUCCESS',
    ].includes(status)
      ? {
          type: statusToAlertType[status] || 'ERROR',
          text: 'settings.general.lighthouseConsole.status.' + status,
          loadingIndicator: status === 'CHECKING',
        }
      : undefined;
  }

  async browseForLighthouseConsole() {
    const path = await this.fileDialog.open({
      defaultPath:
        'C:\\Program Files (x86)\\Steam\\steamapps\\common\\SteamVR\\tools\\lighthouse\\bin\\win64',
      directory: false,
      multiple: false,
      filters: [
        {
          name: 'Lighthouse Console',
          extensions: ['exe'],
        },
      ],
    });
    if (path && typeof path === 'string') {
      this.lighthouseConsolePathInputChange.next(null);
      await this.lighthouse.setConsolePath(path);
    }
  }

  async setElevatedFeaturesEnabled(enabled: boolean) {
    if (!enabled) {
      await this.elevatedSidecar.disable();
      return;
    }
    await this.elevatedSidecar.enable();
  }

  update(changes: Partial<AppSettings>) {
    this.settingsService.updateSettings(changes);
  }

  setTelemetryEnabled(enabled: boolean) {
    this.telemetry.updateSettings({ enabled });
  }

  setExitInSystemTray(exitInSystemTray: boolean) {
    this.settingsService.updateSettings({ exitInSystemTray });
  }

  setStartInSystemTray(startInSystemTray: boolean) {
    this.settingsService.updateSettings({ startInSystemTray });
  }

  setLighthousePowerControl(enabled: boolean) {
    this.settingsService.updateSettings({ lighthousePowerControl: enabled });
  }

  setLighthousePowerOffDelay(enabled: boolean) {
    this.settingsService.updateSettings({ lighthousePowerOffDelay: enabled });
  }

  onChangeLighthousePowerOffMode(state: LighthouseDevicePowerState) {
    this.settingsService.updateSettings({ lighthousePowerOffState: state });
  }

  onChangeSleepModeStartupBehaviour(option: SelectBoxItem | undefined) {
    if (!option) return;
    this.settingsService.updateSettings({
      sleepModeStartupBehaviour: option.id as 'PERSIST' | 'ACTIVE' | 'INACTIVE',
    });
  }

  setOverlayMenuEnabled(enabled: boolean) {
    this.settingsService.updateSettings({ overlayMenuEnabled: enabled });
  }

  setOverlayMenuOnlyOpenWhenVRChatIsRunning(enabled: boolean) {
    this.settingsService.updateSettings({ overlayMenuOnlyOpenWhenVRChatIsRunning: enabled });
  }

  setQuitWithSteamVR(enabled: boolean) {
    this.settingsService.updateSettings({ quitWithSteamVR: enabled });
  }

  setStartWithSteamVR(enabled: boolean) {
    void this.openvr.setStartWithSteamVR(enabled).catch(() => undefined);
  }

  protected readonly OVRInputEventAction = OVRInputEventAction;
}
