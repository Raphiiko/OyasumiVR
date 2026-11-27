import { Injectable } from '@angular/core';
import { BehaviorSubject, firstValueFrom, Observable } from 'rxjs';
import { commands } from 'src-ui/app/bindings';
import { BUILD_ID, FLAVOUR } from '../../build';
import { getVersion } from '../utils/app-utils';
import { DebugReportModalComponent } from '../views/dashboard-view/views/settings-troubleshooting-view/debug-report-modal/debug-report-modal.component';
import { AppSettingsService } from './app-settings.service';
import { ElevatedSidecarService } from './elevated-sidecar.service';
import { FontLoaderService } from './font-loader.service';
import { PulsoidService } from './integrations/pulsoid.service';
import { LighthouseService } from './lighthouse.service';
import { ModalService } from './modal.service';
import { MqttService } from './mqtt/mqtt.service';
import { OpenVRService } from './openvr.service';
import { OscService } from './osc.service';
import { OverlayService } from './overlay/overlay.service';
import { VRChatService } from './vrchat-api/vrchat.service';

const RECENT_CODE_DURATION_MS = 15 * 60 * 1000;
const DEBUG_REPORT_MODAL_ID = 'debugReport';

/** Opens the debug report dialog, and keeps the last report code for a user who closed it. */
@Injectable({
  providedIn: 'root',
})
export class DebugReportService {
  /** The last report code, or null when there is none or it is older than 15 minutes. */
  public readonly recentCode = new BehaviorSubject<string | null>(null);
  private expiry?: ReturnType<typeof setTimeout>;

  constructor(
    private modals: ModalService,
    private appSettings: AppSettingsService,
    private openvr: OpenVRService,
    private overlay: OverlayService,
    private vrchat: VRChatService,
    private osc: OscService,
    private elevatedSidecar: ElevatedSidecarService,
    private mqtt: MqttService,
    private pulsoid: PulsoidService,
    private lighthouse: LighthouseService,
    private fontLoader: FontLoaderService
  ) {}

  /** Opens one debug report dialog at most, because the core keeps one pending zip for it. */
  open() {
    if (this.modals.isModalOpen(DEBUG_REPORT_MODAL_ID)) return;
    this.modals
      .addModal(DebugReportModalComponent, undefined, { id: DEBUG_REPORT_MODAL_ID })
      .subscribe();
  }

  setRecentCode(code: string) {
    clearTimeout(this.expiry);
    this.recentCode.next(code);
    this.expiry = setTimeout(() => this.recentCode.next(null), RECENT_CODE_DURATION_MS);
  }

  /** The state only the UI knows, for the report.json of a debug report. */
  async collectUiState(): Promise<Record<string, unknown>> {
    const first = <T>(source: Observable<T>) => firstValueFrom(source);
    const port = (command: () => Promise<number | null>) => command().catch(() => null);
    const settings = await first(this.appSettings.settings);
    return {
      app: { version: await getVersion(), flavour: FLAVOUR, buildId: BUILD_ID },
      steamvr: {
        status: await first(this.openvr.status),
        autoLaunch: settings.startWithSteamVR,
      },
      overlaySidecarStarted: await first(this.overlay.sidecarStarted),
      steamvrDashboardRenderMode: await commands.openvrDashboardRenderMode(),
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
        coreGrpc: await port(commands.getCoreGrpcPort),
        coreGrpcWeb: await port(commands.getCoreGrpcWebPort),
        elevatedSidecarGrpc: await port(commands.elevatedSidecarGetGrpcPort),
        overlaySidecarGrpc: await port(commands.overlaySidecarGetGrpcPort),
      },
    };
  }
}
