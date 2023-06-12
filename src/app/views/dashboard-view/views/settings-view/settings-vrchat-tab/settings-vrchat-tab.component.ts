import { Component, OnInit } from '@angular/core';
import { SettingsTabComponent } from '../settings-tab/settings-tab.component';
import { AppSettingsService } from '../../../../../services/app-settings.service';
import { hshrink, vshrink } from '../../../../../utils/animations';
import { VRChatService, VRChatServiceStatus } from '../../../../../services/vrchat.service';
import { debounceTime, distinctUntilChanged, Subject, tap } from 'rxjs';
import { CurrentUser as VRChatUser } from 'vrchat/dist';
import { ModalService } from 'src/app/services/modal.service';
import { OscAddressValidation, OscService } from '../../../../../services/osc.service';
import { APP_SETTINGS_DEFAULT } from '../../../../../models/settings';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

@Component({
  selector: 'app-settings-vrchat-tab',
  templateUrl: './settings-vrchat-tab.component.html',
  styleUrls: ['./settings-vrchat-tab.component.scss'],
  animations: [vshrink(), hshrink()],
})
export class SettingsVRChatTabComponent extends SettingsTabComponent implements OnInit {
  // VRChat Account
  protected vrchatStatus: VRChatServiceStatus = 'PRE_INIT';
  protected currentUser: VRChatUser | null = null;

  // Sending Host
  protected oscSendingHost = '';
  protected oscSendingHostChange: Subject<string> = new Subject<string>();
  protected oscSendingHostStatus: 'INIT' | 'OK' | 'CHECKING' | 'ERROR' = 'INIT';
  protected oscSendingHostError?: string;
  // Sending Port
  protected oscSendingPort = 0;
  protected oscSendingPortChange: Subject<string> = new Subject<string>();
  protected oscSendingPortStatus: 'INIT' | 'OK' | 'CHECKING' | 'ERROR' = 'INIT';
  protected oscSendingPortError?: string;
  // Receiving Host
  protected oscReceivingHost = '';
  protected oscReceivingHostChange: Subject<string> = new Subject<string>();
  protected oscReceivingHostStatus: 'INIT' | 'OK' | 'CHECKING' | 'ERROR' = 'INIT';
  protected oscReceivingHostError?: string;
  // Receiving Port
  protected oscReceivingPort = 0;
  protected oscReceivingPortChange: Subject<string> = new Subject<string>();
  protected oscReceivingPortStatus: 'INIT' | 'OK' | 'CHECKING' | 'ERROR' = 'INIT';
  protected oscReceivingPortError?: string;

  protected get someOSCFeaturesEnabled() {
    return this.appSettings.oscEnableExpressionMenu || this.appSettings.oscEnableExternalControl;
  }

  constructor(
    settingsService: AppSettingsService,
    private vrchat: VRChatService,
    private modalService: ModalService,
    private osc: OscService
  ) {
    super(settingsService);
  }

  override async ngOnInit() {
    super.ngOnInit();
    // Listen for account changes
    this.vrchat.status
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((status) => (this.vrchatStatus = status));
    this.vrchat.user
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((user) => (this.currentUser = user));
    this.listenForReceivingHostChanges();
    this.listenForReceivingPortChanges();
    this.listenForSendingHostChanges();
    this.listenForSendingPortChanges();
    this.listenForSettingsChanges();
    this.listenForValidationChanges();
  }

  listenForValidationChanges() {
    this.osc.addressValidation
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((validation) => this.processValidation(validation));
  }

  listenForSettingsChanges() {
    this.settingsService.settings
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((settings) => {
        if (settings.oscReceivingHost !== this.oscReceivingHost) {
          this.oscReceivingHost = settings.oscReceivingHost;
          this.oscReceivingHostChange.next(this.oscReceivingHost);
        }
        if (settings.oscReceivingPort !== this.oscReceivingPort) {
          this.oscReceivingPort = settings.oscReceivingPort;
          this.oscReceivingPortChange.next(this.oscReceivingPort + '');
        }
        if (settings.oscSendingHost !== this.oscSendingHost) {
          this.oscSendingHost = settings.oscSendingHost;
          this.oscSendingHostChange.next(this.oscSendingHost);
        }
        if (settings.oscSendingPort !== this.oscSendingPort) {
          this.oscSendingPort = settings.oscSendingPort;
          this.oscSendingPortChange.next(this.oscSendingPort + '');
        }
      });
  }

  listenForReceivingHostChanges() {
    this.oscReceivingHostChange
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        distinctUntilChanged(),
        tap(() => {
          this.oscReceivingHostStatus = 'CHECKING';
          this.oscReceivingHostError = undefined;
        }),
        debounceTime(300)
      )
      .subscribe(async (host) => {
        this.oscReceivingHost = host;
        await this.osc.setOscReceivingAddress(this.oscReceivingHost, this.oscReceivingPort);
      });
  }

  listenForSendingHostChanges() {
    this.oscSendingHostChange
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        distinctUntilChanged(),
        tap(() => {
          this.oscSendingHostStatus = 'CHECKING';
          this.oscSendingHostError = undefined;
        }),
        debounceTime(300)
      )
      .subscribe(async (host) => {
        this.oscSendingHost = host;
        await this.osc.setOscSendingAddress(this.oscSendingHost, this.oscSendingPort);
      });
  }

  listenForReceivingPortChanges() {
    this.oscReceivingPortChange
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        distinctUntilChanged(),
        tap(() => {
          this.oscReceivingPortStatus = 'CHECKING';
          this.oscReceivingPortError = undefined;
        }),
        debounceTime(300)
      )
      .subscribe(async (port) => {
        this.oscReceivingPort = parseInt(port);
        if (isNaN(this.oscReceivingPort)) this.oscReceivingPort = 0;
        await this.osc.setOscReceivingAddress(this.oscReceivingHost, this.oscReceivingPort);
      });
  }

  listenForSendingPortChanges() {
    this.oscSendingPortChange
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        distinctUntilChanged(),
        tap(() => {
          this.oscSendingPortStatus = 'CHECKING';
          this.oscSendingPortError = undefined;
        }),
        debounceTime(300)
      )
      .subscribe(async (port) => {
        this.oscSendingPort = parseInt(port);
        if (isNaN(this.oscSendingPort)) this.oscSendingPort = 0;
        await this.osc.setOscSendingAddress(this.oscSendingHost, this.oscSendingPort);
      });
  }

  processValidation(validation: OscAddressValidation) {
    this.oscReceivingHostError = validation.oscReceivingHost?.length
      ? validation.oscReceivingHost[0]
      : undefined;
    this.oscReceivingHostStatus = validation.oscReceivingHost?.length ? 'ERROR' : 'OK';
    this.oscReceivingPortError = validation.oscReceivingPort?.length
      ? validation.oscReceivingPort[0]
      : undefined;
    this.oscReceivingPortStatus = validation.oscReceivingPort?.length ? 'ERROR' : 'OK';
    this.oscSendingHostError = validation.oscSendingHost?.length
      ? validation.oscSendingHost[0]
      : undefined;
    this.oscSendingHostStatus = validation.oscSendingHost?.length ? 'ERROR' : 'OK';
    this.oscSendingPortError = validation.oscSendingPort?.length
      ? validation.oscSendingPort[0]
      : undefined;
    this.oscSendingPortStatus = validation.oscSendingPort?.length ? 'ERROR' : 'OK';
  }

  login() {
    this.vrchat.showLoginModal();
  }

  async logout() {
    await this.vrchat.logout();
  }

  resetOSCAddresses() {
    this.oscSendingHostChange.next(APP_SETTINGS_DEFAULT.oscSendingHost);
    this.oscSendingPortChange.next(APP_SETTINGS_DEFAULT.oscSendingPort + '');
    this.oscReceivingHostChange.next(APP_SETTINGS_DEFAULT.oscReceivingHost);
    this.oscReceivingPortChange.next(APP_SETTINGS_DEFAULT.oscReceivingPort + '');
  }

  toggleOSCExpressionMenu() {
    this.settingsService.updateSettings({
      oscEnableExpressionMenu: !this.appSettings.oscEnableExpressionMenu,
    });
  }

  toggleOSCExternalControl() {
    this.settingsService.updateSettings({
      oscEnableExternalControl: !this.appSettings.oscEnableExternalControl,
    });
  }

  disableAllOSCFeatures() {
    this.settingsService.updateSettings({
      oscEnableExpressionMenu: !this.someOSCFeaturesEnabled,
      oscEnableExternalControl: !this.someOSCFeaturesEnabled,
    });
  }
}
