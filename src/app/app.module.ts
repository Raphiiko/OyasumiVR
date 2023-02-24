import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { CommonModule } from '@angular/common';
import { AppRoutingModule } from './app-routing.module';
import { AppComponent } from './app.component';
import { ThemeService } from './services/theme.service';
import { DashboardViewComponent } from './views/dashboard-view/dashboard-view.component';
import { BatteryAutomationsViewComponent } from './views/dashboard-view/views/battery-automations-view/battery-automations-view.component';
import { SettingsViewComponent } from './views/dashboard-view/views/settings-view/settings-view.component';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { VarDirective } from './directives/var.directive';
import { AboutViewComponent } from './views/dashboard-view/views/about-view/about-view.component';
import { TranslateLoader, TranslateModule } from '@ngx-translate/core';
import { TranslateHttpLoader } from '@ngx-translate/http-loader';
import { HttpClient, HttpClientModule } from '@angular/common/http';
import { OverviewViewComponent } from './views/dashboard-view/views/overview-view/overview-view.component';
import { SleepDetectionViewComponent } from './views/dashboard-view/views/sleep-detection-view/sleep-detection-view.component';
import {
  DefaultSimpleModalOptionConfig,
  defaultSimpleModalOptions,
  SimpleModalModule,
  SimpleModalService,
} from 'ngx-simple-modal';
import { TimeEnableSleepModeModalComponent } from './views/dashboard-view/views/sleep-detection-view/time-enable-sleepmode-modal/time-enable-sleep-mode-modal.component';
import { TimeDisableSleepModeModalComponent } from './views/dashboard-view/views/sleep-detection-view/time-disable-sleepmode-modal/time-disable-sleep-mode-modal.component';
import { BatteryPercentageEnableSleepModeModalComponent } from './views/dashboard-view/views/sleep-detection-view/battery-percentage-enable-sleepmode-modal/battery-percentage-enable-sleep-mode-modal.component';
import { DevicePowerOnDisableSleepModeModalComponent } from './views/dashboard-view/views/sleep-detection-view/device-poweron-disable-sleepmode-modal/device-power-on-disable-sleep-mode-modal.component';
import { SleepModeEnableOnControllersPoweredOffAutomationService } from './services/sleep-detection-automations/sleep-mode-enable-on-controllers-powered-off-automation.service';
import { SleepModeEnableAtBatteryPercentageAutomationService } from './services/sleep-detection-automations/sleep-mode-enable-at-battery-percentage-automation.service';
import { SleepModeEnableAtTimeAutomationService } from './services/sleep-detection-automations/sleep-mode-enable-at-time-automation.service';
import { SleepModeDisableAtTimeAutomationService } from './services/sleep-detection-automations/sleep-mode-disable-at-time-automation.service';
import { SleepModeDisableOnDevicePowerOnAutomationService } from './services/sleep-detection-automations/sleep-mode-disable-on-device-power-on-automation.service';
import { TurnOffDevicesWhenChargingAutomationService } from './services/battery-automations/turn-off-devices-when-charging-automation.service';
import { TurnOffDevicesOnSleepModeEnableAutomationService } from './services/battery-automations/turn-off-devices-on-sleep-mode-enable-automation.service';
import { NVMLService } from './services/nvml.service';
import { OpenVRService } from './services/openvr.service';
import { GpuAutomationsViewComponent } from './views/dashboard-view/views/gpu-automations-view/gpu-automations-view.component';
import { SleepService } from './services/sleep.service';
import { GpuAutomationsService } from './services/gpu-automations.service';
import { PowerLimitInputComponent } from './views/dashboard-view/views/gpu-automations-view/power-limit-input/power-limit-input.component';
import { NgPipesModule } from 'ngx-pipes';
import { SleepingPoseViewerComponent } from './components/sleeping-pose-viewer/sleeping-pose-viewer.component';
import { OscService } from './services/osc.service';
import { OscAutomationsViewComponent } from './views/dashboard-view/views/osc-automations-view/osc-automations-view.component';
import { SelectBoxComponent } from './components/select-box/select-box.component';
import { TStringTranslatePipePipe } from './pipes/tstring-translate.pipe';
import { OscScriptButtonComponent } from './components/osc-script-button/osc-script-button.component';
import { OscScriptModalComponent } from './components/osc-script-modal/osc-script-modal.component';
import { OscScriptCodeEditorComponent } from './components/osc-script-code-editor/osc-script-code-editor.component';
import { DropdownButtonComponent } from './components/dropdown-button/dropdown-button.component';
import { OscScriptSimpleEditorComponent } from './components/osc-script-simple-editor/osc-script-simple-editor.component';
import { DashboardNavbarComponent } from './components/dashboard-navbar/dashboard-navbar.component';
import { DeviceListComponent } from './components/device-list/device-list.component';
import { DeviceListItemComponent } from './components/device-list-item/device-list-item.component';
import { SleepingAnimationsAutomationService } from './services/osc-automations/sleeping-animations-automation.service';
import { ElevatedSidecarService } from './services/elevated-sidecar.service';
import { ConfirmModalComponent } from './components/confirm-modal/confirm-modal.component';
import { UpdateService } from './services/update.service';
import { UpdateModalComponent } from './components/update-modal/update-modal.component';
import { TelemetryService } from './services/telemetry.service';
import { LanguageSelectModalComponent } from './components/language-select-modal/language-select-modal.component';
import { AppSettingsService } from './services/app-settings.service';
import { filter } from 'rxjs';
import { VRChatService } from './services/vrchat.service';
import { SettingsGeneralTabComponent } from './views/dashboard-view/views/settings-view/settings-general-tab/settings-general-tab.component';
import { SettingsUpdatesTabComponent } from './views/dashboard-view/views/settings-view/settings-updates-tab/settings-updates-tab.component';
import { SettingsDebugTabComponent } from './views/dashboard-view/views/settings-view/settings-debug-tab/settings-debug-tab.component';
import { SettingsVRChatTabComponent } from './views/dashboard-view/views/settings-view/settings-vrchat-tab/settings-vrchat-tab.component';
import { VRChatLoginModalComponent } from './components/vrchat-login-modal/vrchat-login-modal.component';
import { VRChatLoginTFAModalComponent } from './components/vrchat-login-tfa-modal/vrchat-login-tfa-modal.component';
import { StatusAutomationsViewComponent } from './views/dashboard-view/views/status-automations-view/status-automations-view.component';
import { SleepingAnimationPresetModalComponent } from './components/sleeping-animation-preset-modal/sleeping-animation-preset-modal.component';
import { VRChatLogService } from './services/vrchat-log.service';
import { StatusChangeForPlayerCountAutomationService } from './services/status-automations/status-change-for-player-count-automation.service';
import { MainStatusBarComponent } from './components/main-status-bar/main-status-bar.component';
import { OscControlService } from './services/osc-control.service';
import { AutoInviteRequestAcceptViewComponent } from './views/dashboard-view/views/auto-invite-request-accept-view/auto-invite-request-accept-view.component';
import { FriendSelectionModalComponent } from './components/friend-selection-modal/friend-selection-modal.component';
import { CachedValue } from './utils/cached-value';
import { ImageCacheService } from './services/image-cache.service';
import { ImageCachePipe } from './pipes/image-cache.pipe';
import { InviteAutomationsService } from './services/invite-automations.service';
import { GpuPowerlimitingPaneComponent } from './views/dashboard-view/views/gpu-automations-view/gpu-powerlimiting-pane/gpu-powerlimiting-pane.component';
import { MsiAfterburnerPaneComponent } from './views/dashboard-view/views/gpu-automations-view/msi-afterburner-pane/msi-afterburner-pane.component';
import { invoke } from '@tauri-apps/api';
import { SleepModeChangeOnSteamVRStatusAutomationService } from './services/sleep-detection-automations/sleep-mode-change-on-steamvr-status-automation.service';
import { ImageFallbackDirective } from './directives/image-fallback.directive';
import { SleepDebugViewComponent } from './views/sleep-debug-view/sleep-debug-view.component';
import { SleepModeForSleepDetectorAutomationService } from './services/sleep-detection-automations/sleep-mode-for-sleep-detector-automation.service';
import { SleepDetectorCalibrationModalComponent } from './views/dashboard-view/views/sleep-detection-view/sleep-detector-calibration-modal/sleep-detector-calibration-modal.component';
import {
  SleepDetectorEnableSleepModeModalComponent
} from "./views/dashboard-view/views/sleep-detection-view/sleep-detector-enable-sleepmode-modal/sleep-detector-enable-sleep-mode-modal.component";
import { SettingsNotificationsTabComponent } from './views/dashboard-view/views/settings-view/settings-notifications-tab/settings-notifications-tab.component';

export function createTranslateLoader(http: HttpClient) {
  return new TranslateHttpLoader(http, './assets/i18n/', '.json');
}

@NgModule({
  bootstrap: [AppComponent],
  declarations: [
    AppComponent,
    DashboardViewComponent,
    BatteryAutomationsViewComponent,
    SettingsViewComponent,
    DashboardNavbarComponent,
    DeviceListComponent,
    DeviceListItemComponent,
    VarDirective,
    ImageFallbackDirective,
    AboutViewComponent,
    OverviewViewComponent,
    SleepDetectionViewComponent,
    SleepDetectorCalibrationModalComponent,
    SleepDetectorEnableSleepModeModalComponent,
    TimeEnableSleepModeModalComponent,
    TimeDisableSleepModeModalComponent,
    BatteryPercentageEnableSleepModeModalComponent,
    DevicePowerOnDisableSleepModeModalComponent,
    GpuAutomationsViewComponent,
    PowerLimitInputComponent,
    SleepingPoseViewerComponent,
    OscAutomationsViewComponent,
    SelectBoxComponent,
    TStringTranslatePipePipe,
    ImageCachePipe,
    OscScriptButtonComponent,
    OscScriptModalComponent,
    OscScriptCodeEditorComponent,
    DropdownButtonComponent,
    OscScriptSimpleEditorComponent,
    ConfirmModalComponent,
    UpdateModalComponent,
    LanguageSelectModalComponent,
    SettingsGeneralTabComponent,
    SettingsNotificationsTabComponent,
    SettingsUpdatesTabComponent,
    SettingsDebugTabComponent,
    SettingsVRChatTabComponent,
    VRChatLoginModalComponent,
    VRChatLoginTFAModalComponent,
    StatusAutomationsViewComponent,
    SleepingAnimationPresetModalComponent,
    MainStatusBarComponent,
    AutoInviteRequestAcceptViewComponent,
    FriendSelectionModalComponent,
    GpuPowerlimitingPaneComponent,
    MsiAfterburnerPaneComponent,
    SleepDebugViewComponent,
  ],
  imports: [
    CommonModule,
    BrowserModule,
    BrowserAnimationsModule,
    AppRoutingModule,
    SimpleModalModule,
    HttpClientModule,
    TranslateModule.forRoot({
      defaultLanguage: 'en',
      loader: {
        provide: TranslateLoader,
        useFactory: createTranslateLoader,
        deps: [HttpClient],
      },
    }),
    NgPipesModule,
  ],
  providers: [
    ThemeService,
    {
      provide: DefaultSimpleModalOptionConfig,
      useValue: {
        ...defaultSimpleModalOptions,
        ...{
          closeOnEscape: true,
          closeOnClickOutside: false,
          wrapperDefaultClasses: 'modal-wrapper',
          animationDuration: '150',
        },
      },
    },
  ],
})
export class AppModule {
  constructor(
    private openvrService: OpenVRService,
    private nvmlService: NVMLService,
    private sleepService: SleepService,
    private oscService: OscService,
    private oscControlService: OscControlService,
    private sidecarService: ElevatedSidecarService,
    private updateService: UpdateService,
    private telemetryService: TelemetryService,
    private appSettingsService: AppSettingsService,
    private modalService: SimpleModalService,
    private vrchatService: VRChatService,
    private vrchatLogService: VRChatLogService,
    private imageCacheService: ImageCacheService,
    // GPU automations
    private gpuAutomations: GpuAutomationsService,
    // Sleep mode automations
    private sleepModeForSleepDetectorAutomationService: SleepModeForSleepDetectorAutomationService,
    private sleepModeEnableOnControllersPoweredOffAutomation: SleepModeEnableOnControllersPoweredOffAutomationService,
    private sleepModeEnableAtBatteryPercentageAutomation: SleepModeEnableAtBatteryPercentageAutomationService,
    private sleepModeEnableAtTimeAutomationService: SleepModeEnableAtTimeAutomationService,
    private sleepModeChangeOnSteamVRStatusAutomationService: SleepModeChangeOnSteamVRStatusAutomationService,
    private sleepModeDisableAtTimeAutomationService: SleepModeDisableAtTimeAutomationService,
    private sleepModeDisableOnDevicePowerOnAutomationService: SleepModeDisableOnDevicePowerOnAutomationService,
    // Battery automations
    private turnOffDevicesOnSleepModeEnableAutomationService: TurnOffDevicesOnSleepModeEnableAutomationService,
    private turnOffDevicesWhenChargingAutomationService: TurnOffDevicesWhenChargingAutomationService,
    // OSC automations
    private sleepingAnimationsAutomationService: SleepingAnimationsAutomationService,
    // Status automations
    private statusChangeForPlayerCountAutomationService: StatusChangeForPlayerCountAutomationService,
    // Invite automations
    private inviteAutomationsService: InviteAutomationsService
  ) {
    this.init();
  }

  async init() {
    // Clean cache
    await CachedValue.cleanCache();
    // Initialize app settings
    await this.appSettingsService.init();
    // Initialize telemetry and updates
    await Promise.all([this.updateService.init(), this.telemetryService.init()]);
    // Initialize general utility services
    await Promise.all([
      this.openvrService.init(),
      this.oscService.init().then(async () => {
        await this.oscControlService.init();
      }),
      this.sleepService.init(),
      this.vrchatService.init(),
      this.vrchatLogService.init(),
      this.imageCacheService.init(),
    ]);
    // Initialize GPU control services
    await this.sidecarService.init().then(async () => {
      await this.nvmlService.init();
    });
    // Initialize automations
    await Promise.all([
      // GPU automations
      this.gpuAutomations.init(),
      // Sleep mode automations
      this.sleepModeForSleepDetectorAutomationService.init(),
      this.sleepModeEnableOnControllersPoweredOffAutomation.init(),
      this.sleepModeEnableAtBatteryPercentageAutomation.init(),
      this.sleepModeEnableAtTimeAutomationService.init(),
      this.sleepModeChangeOnSteamVRStatusAutomationService.init(),
      this.sleepModeDisableAtTimeAutomationService.init(),
      this.sleepModeDisableOnDevicePowerOnAutomationService.init(),
      // Battery automations
      this.turnOffDevicesOnSleepModeEnableAutomationService.init(),
      this.turnOffDevicesWhenChargingAutomationService.init(),
      // OSC automations
      this.sleepingAnimationsAutomationService.init(),
      // Status automations
      this.statusChangeForPlayerCountAutomationService.init(),
      // Invite automations
      this.inviteAutomationsService.init(),
    ]);
    await invoke('close_splashscreen');
    // Language selection modal
    this.appSettingsService.loadedDefaults
      .pipe(filter((loadedDefaults) => loadedDefaults))
      .subscribe(() => {
        this.modalService
          .addModal(LanguageSelectModalComponent, void 0, {
            closeOnEscape: false,
            closeOnClickOutside: false,
          })
          .subscribe();
      });
  }
}
