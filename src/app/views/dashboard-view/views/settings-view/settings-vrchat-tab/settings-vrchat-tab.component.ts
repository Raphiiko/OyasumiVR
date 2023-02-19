import { Component } from '@angular/core';
import { SettingsTabComponent } from '../settings-tab/settings-tab.component';
import { AppSettingsService } from '../../../../../services/app-settings.service';
import { hshrink, vshrink } from '../../../../../utils/animations';
import { VRChatService, VRChatServiceStatus } from '../../../../../services/vrchat.service';
import {
  combineLatest,
  debounceTime,
  delay,
  distinctUntilChanged,
  map,
  of,
  startWith,
  Subject,
  switchMap,
  takeUntil,
  tap,
} from 'rxjs';
import { CurrentUser as VRChatUser } from 'vrchat/dist';
import { SimpleModalService } from 'ngx-simple-modal';
import { OscService } from '../../../../../services/osc.service';
import { isValidHostname, isValidIPv4, isValidIPv6 } from '../../../../../utils/regex-utils';
import { APP_SETTINGS_DEFAULT } from '../../../../../models/settings';

@Component({
  selector: 'app-settings-vrchat-tab',
  templateUrl: './settings-vrchat-tab.component.html',
  styleUrls: ['./settings-vrchat-tab.component.scss'],
  animations: [vshrink(), hshrink()],
})
export class SettingsVRChatTabComponent extends SettingsTabComponent {
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

  constructor(
    settingsService: AppSettingsService,
    private vrchat: VRChatService,
    private modalService: SimpleModalService,
    private osc: OscService
  ) {
    super(settingsService);
  }

  override async ngOnInit() {
    super.ngOnInit();
    // Listen for account changes
    this.vrchat.status
      .pipe(takeUntil(this.destroy$))
      .subscribe((status) => (this.vrchatStatus = status));
    this.vrchat.user.pipe(takeUntil(this.destroy$)).subscribe((user) => (this.currentUser = user));
    this.listenForReceivingHostChanges();
    this.listenForReceivingPortChanges();
    this.listenForSendingHostChanges();
    this.listenForSendingPortChanges();
    this.listenForSettingsChanges();
  }

  listenForSettingsChanges() {
    this.settingsService.settings.pipe(takeUntil(this.destroy$)).subscribe((settings) => {
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
        takeUntil(this.destroy$),
        distinctUntilChanged(),
        switchMap((value) => combineLatest([of(value)]).pipe(map(([value]) => value))),
        tap(() => {
          this.oscReceivingHostStatus = 'CHECKING';
          this.oscReceivingHostError = undefined;
        }),
        debounceTime(300)
      )
      .subscribe(async (host) => {
        // Validate host
        if (host === '' || !(isValidIPv6(host) || isValidIPv4(host) || isValidHostname(host))) {
          this.oscReceivingHostStatus = 'ERROR';
          this.oscReceivingHostError = 'invalidHost';
          return;
        }
        // Try to bind
        if (!(await this.osc.init_receiver(host, this.oscReceivingPort))) {
          this.oscReceivingPortStatus = 'ERROR';
          this.oscReceivingPortError = 'bindFailed';
          return;
        }
        // Save new host
        this.oscReceivingHost = host;
        this.oscReceivingHostStatus = 'OK';
        this.settingsService.updateSettings({
          oscReceivingHost: host,
        });
      });
  }

  listenForSendingHostChanges() {
    this.oscSendingHostChange
      .pipe(
        takeUntil(this.destroy$),
        distinctUntilChanged(),
        switchMap((value) => combineLatest([of(value)]).pipe(map(([value]) => value))),
        tap(() => {
          this.oscSendingHostStatus = 'CHECKING';
          this.oscSendingHostError = undefined;
        }),
        debounceTime(300)
      )
      .subscribe(async (host) => {
        // Validate host
        if (host === '' || !(isValidIPv6(host) || isValidIPv4(host) || isValidHostname(host))) {
          this.oscSendingHostStatus = 'ERROR';
          this.oscSendingHostError = 'invalidHost';
          return;
        }
        // Save new host
        this.oscSendingHost = host;
        this.oscSendingHostStatus = 'OK';
        this.settingsService.updateSettings({
          oscSendingHost: host,
        });
      });
  }

  listenForReceivingPortChanges() {
    this.oscReceivingPortChange
      .pipe(
        takeUntil(this.destroy$),
        distinctUntilChanged(),
        switchMap((value) =>
          combineLatest([
            this.settingsService.settings.pipe(
              map((settings) => settings.oscSendingPort),
              startWith(this.oscSendingPort),
              distinctUntilChanged()
            ),
            of(value),
          ]).pipe(map(([_, value]) => value))
        ),
        tap(() => {
          this.oscReceivingPortStatus = 'CHECKING';
          this.oscReceivingPortError = undefined;
        }),
        debounceTime(300)
      )
      .subscribe(async (value) => {
        // Parse port
        let port = parseInt(value);
        if (isNaN(port) || port > 65535 || port <= 0) {
          this.oscReceivingPortStatus = 'ERROR';
          this.oscReceivingPortError = 'invalidPort';
          return;
        }
        // Validate port
        if (port === this.oscSendingPort && this.oscReceivingHost === this.oscSendingHost) {
          this.oscReceivingPortStatus = 'ERROR';
          this.oscReceivingPortError = 'samePort';
          return;
        }
        // Try to bind
        if (!(await this.osc.init_receiver(this.oscReceivingHost, port))) {
          this.oscReceivingPortStatus = 'ERROR';
          this.oscReceivingPortError = 'bindFailed';
          return;
        }
        // Save new port
        this.oscReceivingPort = port;
        this.oscReceivingPortStatus = 'OK';
        this.settingsService.updateSettings({
          oscReceivingPort: port,
        });
      });
  }

  listenForSendingPortChanges() {
    this.oscSendingPortChange
      .pipe(
        takeUntil(this.destroy$),
        distinctUntilChanged(),
        switchMap((value) =>
          combineLatest([
            this.settingsService.settings.pipe(
              map((settings) => settings.oscReceivingPort),
              startWith(this.oscReceivingPort),
              distinctUntilChanged()
            ),
            of(value),
          ]).pipe(map(([_, value]) => value))
        ),
        tap(() => {
          this.oscSendingPortStatus = 'CHECKING';
          this.oscSendingPortError = undefined;
        }),
        debounceTime(300)
      )
      .subscribe((value) => {
        // Parse port
        let port = parseInt(value);
        if (isNaN(port) || port > 65535 || port <= 0) {
          this.oscSendingPortStatus = 'ERROR';
          this.oscSendingPortError = 'invalidPort';
          return;
        }
        // Validate port
        if (port === this.oscReceivingPort && this.oscReceivingHost === this.oscSendingHost) {
          this.oscSendingPortStatus = 'ERROR';
          this.oscSendingPortError = 'samePort';
          return;
        }
        // Save new port
        this.oscSendingPort = port;
        this.oscSendingPortStatus = 'OK';
        this.settingsService.updateSettings({
          oscSendingPort: port,
        });
      });
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
}
