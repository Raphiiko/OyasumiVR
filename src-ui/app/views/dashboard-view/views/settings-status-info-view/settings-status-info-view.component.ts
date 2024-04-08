import { Component } from '@angular/core';
import { TString } from '../../../../models/translatable-string';
import { firstValueFrom, from, interval, map, Observable, of, startWith, switchMap } from 'rxjs';
import { VRChatService } from '../../../../services/vrchat.service';
import { getVersion } from '../../../../utils/app-utils';
import { BUILD_ID, FLAVOUR } from 'src-ui/build';
import { OscService } from '../../../../services/osc.service';
import { ElevatedSidecarService } from '../../../../services/elevated-sidecar.service';
import { OverlayService } from '../../../../services/overlay/overlay.service';
import { OpenVRService } from '../../../../services/openvr.service';
import { IPCService } from '../../../../services/ipc.service';
import { FontLoaderService } from '../../../../services/font-loader.service';
import { invoke } from '@tauri-apps/api';
import { hshrink } from '../../../../utils/animations';
import { TStringTranslatePipe } from '../../../../pipes/tstring-translate.pipe';
import { writeText } from '@tauri-apps/api/clipboard';
import { MdnsSidecarService } from 'src-ui/app/services/mdns-sidecar.service';

@Component({
  selector: 'app-settings-status-info-view',
  templateUrl: './settings-status-info-view.component.html',
  styleUrls: ['./settings-status-info-view.component.scss'],
  animations: [hshrink()],
})
export class SettingsStatusInfoViewComponent {
  categories: Array<{
    name: TString;
    entries: Array<{
      key: TString;
      value: Observable<TString>;
    }>;
  }> = [];
  compact = true;
  copiedToClipboard: string[] = [];

  constructor(
    vrchat: VRChatService,
    osc: OscService,
    elevatedSidecar: ElevatedSidecarService,
    overlaySidecar: OverlayService,
    mdnsSidecar: MdnsSidecarService,
    openvr: OpenVRService,
    ipc: IPCService,
    fontLoader: FontLoaderService,
    private tsTranslate: TStringTranslatePipe
  ) {
    this.categories = [
      {
        name: 'OyasumiVR Application',
        entries: [
          { key: 'Version', value: from(getVersion().then((v) => v + '-' + FLAVOUR)) },
          { key: 'Build ID', value: of(BUILD_ID) },
          {
            key: 'Elevated Sidecar',
            value: elevatedSidecar.sidecarStarted.pipe(
              map((s) => {
                return s ? 'Running' : 'Not running';
              })
            ),
          },
          {
            key: 'Overlay Sidecar',
            value: overlaySidecar.sidecarStarted.pipe(
              map((s) => {
                return s ? 'Running' : 'Not running';
              })
            ),
          },
          {
            key: 'MDNS Sidecar',
            value: mdnsSidecar.sidecarStarted.pipe(
              map((s) => {
                return s ? 'Running' : 'Not running';
              })
            ),
          },
        ],
      },
      {
        name: 'OpenVR',
        entries: [
          {
            key: 'SteamVR',
            value: openvr.status.pipe(
              map((s) => {
                switch (s) {
                  case 'INACTIVE':
                    return 'Not running';
                  case 'INITIALIZING':
                    return 'Initializing';
                  case 'INITIALIZED':
                    return 'Running';
                }
              })
            ),
          },
          {
            key: 'Devices',
            value: openvr.devices.pipe(map((devices) => devices.length + '')),
          },
        ],
      },
      {
        name: 'OSC & OSCQuery',
        entries: [
          {
            key: 'OSC Host',
            value: osc.oscServerAddress.pipe(
              map((a) => {
                if (!a) return 'Not running';
                return a.split(':')[0];
              })
            ),
          },
          {
            key: 'OSC Port',
            value: osc.oscServerAddress.pipe(
              map((a) => {
                if (!a) return 'Not running';
                return a.split(':')[1];
              })
            ),
          },
          {
            key: 'OSCQuery Host',
            value: osc.oscQueryServerAddress.pipe(
              map((a) => {
                if (!a) return 'Not running';
                return a.split(':')[0];
              })
            ),
          },
          {
            key: 'OSCQuery Port',
            value: osc.oscQueryServerAddress.pipe(
              map((a) => {
                if (!a) return 'Not running';
                return a.split(':')[1];
              })
            ),
          },
        ],
      },
      {
        name: 'HTTP & gRPC',
        entries: [
          {
            key: 'Core HTTP Port',
            value: interval(1000).pipe(map(() => fontLoader.httpServerPort + '')),
          },
          {
            key: 'Core gRPC Port',
            value: interval(1000).pipe(
              startWith(void 0),
              switchMap(
                async () => ((await invoke<number | null>('get_core_grpc_port')) ?? 'Unknown') + ''
              )
            ),
          },
          {
            key: 'Core gRPC Web Port',
            value: interval(1000).pipe(
              startWith(void 0),
              switchMap(
                async () =>
                  ((await invoke<number | null>('get_core_grpc_web_port')) ?? 'Unknown') + ''
              )
            ),
          },
          {
            key: 'Elevated Sidecar gRPC Port',
            value: interval(1000).pipe(
              startWith(void 0),
              switchMap(
                async () =>
                  ((await invoke<number | null>('elevated_sidecar_get_grpc_port')) ?? 'Unknown') +
                  ''
              )
            ),
          },
          {
            key: 'Elevated Sidecar gRPC Web Port',
            value: interval(1000).pipe(
              startWith(void 0),
              switchMap(
                async () =>
                  ((await invoke<number | null>('elevated_sidecar_get_grpc_web_port')) ??
                    'Unknown') + ''
              )
            ),
          },
          {
            key: 'Overlay Sidecar gRPC Port',
            value: interval(1000).pipe(
              startWith(void 0),
              switchMap(
                async () =>
                  ((await invoke<number | null>('overlay_sidecar_get_grpc_port')) ?? 'Unknown') + ''
              )
            ),
          },
          {
            key: 'Overlay Sidecar gRPC Web Port',
            value: interval(1000).pipe(
              startWith(void 0),
              switchMap(
                async () =>
                  ((await invoke<number | null>('overlay_sidecar_get_grpc_web_port')) ??
                    'Unknown') + ''
              )
            ),
          },
        ],
      },
      {
        name: 'VRChat',
        entries: [
          {
            key: 'Client',
            value: vrchat.vrchatProcessActive.pipe(
              map((active) => (active ? 'Running' : 'Inactive'))
            ),
          },
          {
            key: 'Login Status',
            value: vrchat.status.pipe(
              map((s) => {
                switch (s) {
                  case 'PRE_INIT':
                    return 'Not initialized';
                  case 'LOGGED_OUT':
                    return 'Logged out';
                  case 'LOGGED_IN':
                    return 'Logged in';
                }
              })
            ),
          },
          {
            key: 'User',
            value: vrchat.user.pipe(
              map((user) => {
                return user?.displayName ?? 'Not logged in';
              })
            ),
          },
          {
            key: 'OSC Host',
            value: osc.vrchatOscAddress.pipe(
              map((a) => {
                if (!a) return 'Unknown';
                return a.split(':')[0];
              })
            ),
          },
          {
            key: 'OSC Port',
            value: osc.vrchatOscAddress.pipe(
              map((a) => {
                if (!a) return 'Unknown';
                return a.split(':')[1];
              })
            ),
          },
          {
            key: 'OSCQuery Host',
            value: osc.vrchatOscQueryAddress.pipe(
              map((a) => {
                if (!a) return 'Unknown';
                return a.split(':')[0];
              })
            ),
          },
          {
            key: 'OSCQuery Port',
            value: osc.vrchatOscQueryAddress.pipe(
              map((a) => {
                if (!a) return 'Unknown';
                return a.split(':')[1];
              })
            ),
          },
        ],
      },
    ];
  }

  async copyToClipboard() {
    this.copiedToClipboard.push('ALL_DATA');
    setTimeout(() => {
      const index = this.copiedToClipboard.findIndex((s) => s === 'ALL_DATA');
      if (index > -1) this.copiedToClipboard.splice(index, 1);
    }, 1000);
    const data: { [s: string]: { [s: string]: string } } = {};
    for (const category of this.categories) {
      const categoryName = this.tsTranslate.transform(category.name) as string;
      data[categoryName] ??= {};
      for (const entry of category.entries) {
        const key = this.tsTranslate.transform(entry.key) as string;
        data[categoryName][key] = this.tsTranslate.transform(
          await firstValueFrom(entry.value)
        ) as string;
      }
    }
    await writeText('```json\n' + JSON.stringify(data, null, 2) + '\n```');
  }
}
