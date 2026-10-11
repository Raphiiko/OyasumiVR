import { ChangeDetectionStrategy, Component } from '@angular/core';
import { invoke } from '@tauri-apps/api/core';
import {
  combineLatest,
  distinctUntilChanged,
  firstValueFrom,
  interval,
  map,
  Observable,
  startWith,
  switchMap,
} from 'rxjs';
import { BUILD_ID, BuildFlavour, FLAVOUR } from '../../../../../../../build';
import { TString } from '../../../../../../models/translatable-string';
import { AppSettingsService } from '../../../../../../services/app-settings.service';
import {
  ElevatedFeaturesFailure,
  ElevatedSidecarService,
} from '../../../../../../services/elevated-sidecar.service';
import { PulsoidService } from '../../../../../../services/integrations/pulsoid.service';
import { LighthouseService } from '../../../../../../services/lighthouse.service';
import { MqttService } from '../../../../../../services/mqtt/mqtt.service';
import { OpenVRService } from '../../../../../../services/openvr.service';
import { OscService } from '../../../../../../services/osc.service';
import { OverlayService } from '../../../../../../services/overlay/overlay.service';
import { ToastService } from '../../../../../../services/toast.service';
import { VRChatService } from '../../../../../../services/vrchat-api/vrchat.service';
import { DebugReportService } from '../../../../../../services/debug-report.service';
import { FontLoaderService } from '../../../../../../services/font-loader.service';
import { ModalService } from '../../../../../../services/modal.service';
import { getVersion } from '../../../../../../utils/app-utils';
import { DebugReportModalComponent } from '../../debug-report-modal/debug-report-modal.component';
import { copyWithToast } from '../../../../../../utils/clipboard-utils';
import { SteamFramePairingService } from '../../../../../../services/steam-frame/steam-frame-pairing.service';
import { SteamFrameConnectionStatus } from '../../../../../../models/steam-frame';

const DEBUG_REPORT_MODAL_ID = 'debugReport';

/** The status line text per connection status, as Device Manager words it. */
const STEAM_FRAME_STATUS_KEYS: Record<SteamFrameConnectionStatus, string> = {
  connecting: 'steamFrame.status.connecting',
  connected: 'steamFrame.status.connected',
  offline: 'steamFrame.status.offline',
  needsAppUpdate: 'steamFrame.status.updateApp',
  helperOutdated: 'steamFrame.status.updateHelper',
  hostKeyChanged: 'steamFrame.status.notRecognized',
  helperMissing: 'steamFrame.status.helperMissing',
  pairingRemoved: 'settings.troubleshooting.status.steamFrame.pairingRemoved',
};

const FLAVOUR_NAMES: Record<BuildFlavour, string> = {
  STEAM: 'Steam',
  STANDALONE: 'Standalone',
  DEV: 'Dev',
};

interface StatusLine {
  label: string;
  value: Observable<TString>;
  /** Untranslated text shown muted before the value. */
  prefix?: Observable<string | undefined>;
  detail?: Observable<TString | null>;
  wide?: boolean;
}

@Component({
  selector: 'app-settings-troubleshooting-status-tab',
  templateUrl: './settings-troubleshooting-status-tab.component.html',
  styleUrls: ['./settings-troubleshooting-status-tab.component.scss'],
  changeDetection: ChangeDetectionStrategy.Eager,
  standalone: false,
})
export class SettingsTroubleshootingStatusTabComponent {
  protected readonly version = getVersion();
  protected readonly build: TString = {
    string: 'settings.troubleshooting.support.version.build',
    values: { flavour: FLAVOUR_NAMES[FLAVOUR], buildId: BUILD_ID },
  };
  protected readonly status: StatusLine[];

  constructor(
    private openvr: OpenVRService,
    private appSettings: AppSettingsService,
    private overlay: OverlayService,
    private vrchat: VRChatService,
    private osc: OscService,
    private elevatedSidecar: ElevatedSidecarService,
    private mqtt: MqttService,
    private pulsoid: PulsoidService,
    private lighthouse: LighthouseService,
    private toasts: ToastService,
    private modals: ModalService,
    private fontLoader: FontLoaderService,
    private steamFrame: SteamFramePairingService,
    protected debugReports: DebugReportService
  ) {
    const settings = this.appSettings.settings;
    this.status = [
      {
        label: 'settings.troubleshooting.status.steamvr.label',
        value: this.openvr.status.pipe(map((s) => `settings.troubleshooting.status.steamvr.${s}`)),
      },
      this.hmdStatus(),
      {
        label: 'settings.troubleshooting.status.steamvrAutoLaunch.label',
        value: settings.pipe(
          map(
            (s) =>
              `settings.troubleshooting.status.steamvrAutoLaunch.${s.startWithSteamVR ? 'on' : 'off'}`
          )
        ),
      },
      {
        label: 'settings.troubleshooting.status.overlay.label',
        value: this.overlay.sidecarStarted.pipe(
          map(
            (started) =>
              `settings.troubleshooting.status.overlay.${started ? 'running' : 'notRunning'}`
          )
        ),
      },
      {
        label: 'settings.troubleshooting.status.steamvrDashboard.label',
        value: this.dashboardRenderMode().pipe(
          map((mode) => `settings.troubleshooting.status.steamvrDashboard.${mode}`)
        ),
      },
      {
        label: 'settings.troubleshooting.status.vrchat.label',
        value: this.vrchat.vrchatProcessActive.pipe(
          map(
            (active) =>
              `settings.troubleshooting.status.vrchat.${active ? 'running' : 'notRunning'}`
          )
        ),
      },
      {
        label: 'settings.troubleshooting.status.vrchatAccount.label',
        value: this.vrchat.status.pipe(
          map(
            (s) =>
              `settings.troubleshooting.status.vrchatAccount.${s === 'LOGGED_IN' ? 'loggedIn' : 'loggedOut'}`
          )
        ),
      },
      { label: 'settings.troubleshooting.status.osc.label', value: this.oscStatus() },
      {
        label: 'settings.troubleshooting.status.mqtt.label',
        value: this.mqtt.clientStatus.pipe(map((s) => `settings.troubleshooting.status.mqtt.${s}`)),
      },
      {
        label: 'settings.troubleshooting.status.adminPrivileges.label',
        value: this.adminPrivilegesStatus(),
        detail: this.elevatedSidecar.failure.pipe(map((f) => this.describeFailure(f))),
        wide: true,
      },
      {
        label: 'settings.troubleshooting.status.pulsoid.label',
        value: this.pulsoid.loggedInUser.pipe(
          map(
            (user) => `settings.troubleshooting.status.pulsoid.${user ? 'loggedIn' : 'loggedOut'}`
          )
        ),
      },
      {
        label: 'settings.troubleshooting.status.steamFrame.label',
        value: this.steamFrameStatus(),
      },
      {
        label: 'settings.troubleshooting.status.bluetooth.label',
        value: this.lighthouse.status.pipe(
          map((s) => `settings.troubleshooting.status.bluetooth.${s}`)
        ),
      },
    ];
  }

  /** Opens one debug report dialog at most, because the core keeps one pending zip for it. */
  openDebugReport() {
    if (this.modals.isModalOpen(DEBUG_REPORT_MODAL_ID)) return;
    this.modals
      .addModal(
        DebugReportModalComponent,
        { collectUiState: () => this.collectUiState() },
        { id: DEBUG_REPORT_MODAL_ID }
      )
      .subscribe();
  }

  /** The state only the UI knows, for the report.json of a debug report. */
  private async collectUiState(): Promise<Record<string, unknown>> {
    const first = <T>(source: Observable<T>) => firstValueFrom(source);
    const port = (command: string) => invoke<number | null>(command).catch(() => null);
    const settings = await first(this.appSettings.settings);
    return {
      app: { version: await this.version, flavour: FLAVOUR, buildId: BUILD_ID },
      steamvr: {
        status: await first(this.openvr.status),
        autoLaunch: settings.startWithSteamVR,
      },
      overlaySidecarStarted: await first(this.overlay.sidecarStarted),
      steamvrDashboardRenderMode: await first(this.dashboardRenderMode()),
      vrchat: {
        processActive: await first(this.vrchat.vrchatProcessActive),
        status: await first(this.vrchat.status),
        websocketStatus: await first(this.vrchat.websocketStatus),
        oscAddress: await first(this.osc.vrchatOscAddress),
        oscQueryAddress: await first(this.osc.vrchatOscQueryAddress),
      },
      osc: {
        serverEnabled: settings.oscServerEnabled,
        serverAddress: await first(this.osc.oscServerAddress),
        oscQueryServerAddress: await first(this.osc.oscQueryServerAddress),
        lastMessageAt: this.osc.lastMessageAt.value,
      },
      elevatedFeatures: {
        enabled: settings.elevatedFeaturesEnabled,
        operation: await first(this.elevatedSidecar.operation),
        sidecarStarted: await first(this.elevatedSidecar.sidecarStarted),
        failure: await first(this.elevatedSidecar.failure),
      },
      mqttStatus: this.mqtt.clientStatus.value,
      pulsoidLoggedIn: !!(await first(this.pulsoid.loggedInUser)),
      lighthouse: {
        status: await first(this.lighthouse.status),
        devices: await first(this.lighthouse.devices),
      },
      ports: {
        coreHttp: this.fontLoader.httpServerPort,
        coreGrpc: await port('get_core_grpc_port'),
        coreGrpcWeb: await port('get_core_grpc_web_port'),
        elevatedSidecarGrpc: await port('elevated_sidecar_get_grpc_port'),
        overlaySidecarGrpc: await port('overlay_sidecar_get_grpc_port'),
      },
    };
  }

  async copyRecentCode(code: string) {
    await copyWithToast(this.toasts, code);
  }

  async copyVersion() {
    const text = `v${await this.version}-${FLAVOUR} (${BUILD_ID})`;
    await copyWithToast(this.toasts, text, 'toasts.clipboard.version');
  }

  private dashboardRenderMode(): Observable<string> {
    return interval(2000).pipe(
      startWith(0),
      switchMap(() => invoke<string>('openvr_dashboard_render_mode')),
      distinctUntilChanged()
    );
  }

  private hmdStatus(): StatusLine {
    const hmd = this.openvr.devices.pipe(
      map((devices) => devices.find((d) => d.class === 'HMD')),
      map((d) => (d?.manufacturerName || d?.modelNumber ? d : undefined))
    );
    return {
      label: 'settings.troubleshooting.status.hmd.label',
      prefix: hmd.pipe(map((d) => d?.manufacturerName)),
      value: hmd.pipe(
        map((d): TString =>
          d
            ? {
                string: 'settings.troubleshooting.status.hmd.value',
                values: { model: d.modelNumber ?? '' },
              }
            : 'settings.troubleshooting.status.hmd.notDetected'
        )
      ),
      wide: true,
    };
  }

  private oscStatus(): Observable<TString> {
    const tick = interval(1000).pipe(startWith(0));
    return combineLatest([this.appSettings.settings, this.osc.lastMessageAt, tick]).pipe(
      map(([settings, lastMessageAt]) => {
        if (!settings.oscServerEnabled) return 'settings.troubleshooting.status.osc.off';
        if (lastMessageAt === null) return 'settings.troubleshooting.status.osc.noMessages';
        const seconds = Math.floor((Date.now() - lastMessageAt) / 1000);
        if (seconds < 60)
          return {
            string: 'settings.troubleshooting.status.osc.seconds',
            values: { value: `${seconds}` },
          };
        const minutes = Math.floor(seconds / 60);
        if (minutes < 60)
          return {
            string: 'settings.troubleshooting.status.osc.minutes',
            values: { value: `${minutes}` },
          };
        return {
          string: 'settings.troubleshooting.status.osc.hours',
          values: { value: `${Math.floor(minutes / 60)}` },
        };
      }),
      distinctUntilChanged((a, b) => JSON.stringify(a) === JSON.stringify(b))
    );
  }

  // ponytail: with several paired headsets, shows the first one; list each if that ever matters
  private steamFrameStatus(): Observable<TString> {
    return combineLatest([this.steamFrame.pairings$, this.steamFrame.connections$]).pipe(
      map(([pairings, connections]) => {
        const pairing = pairings.find((p) => p.complete);
        if (!pairing) return 'settings.troubleshooting.status.steamFrame.notPaired';
        return STEAM_FRAME_STATUS_KEYS[connections[pairing.id]?.status ?? 'connecting'];
      }),
      distinctUntilChanged()
    );
  }

  private adminPrivilegesStatus(): Observable<TString> {
    return combineLatest([
      this.appSettings.settings,
      this.elevatedSidecar.operation,
      this.elevatedSidecar.sidecarStarted,
    ]).pipe(
      map(([settings, operation, started]) => {
        if (operation !== 'idle')
          return `settings.troubleshooting.status.adminPrivileges.${operation}`;
        if (!settings.elevatedFeaturesEnabled)
          return 'settings.troubleshooting.status.adminPrivileges.off';
        return `settings.troubleshooting.status.adminPrivileges.${started ? 'running' : 'notRunning'}`;
      })
    );
  }

  private describeFailure(failure: ElevatedFeaturesFailure | null): TString | null {
    if (!failure) return null;
    const result = failure.result;
    if ('reason' in result)
      return {
        string: `settings.troubleshooting.status.adminPrivileges.failure.${result.result}`,
        values: { reason: result.reason },
      };
    return `settings.troubleshooting.status.adminPrivileges.failure.${result.result}`;
  }
}
