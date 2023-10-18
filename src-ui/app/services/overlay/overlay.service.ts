import { Injectable } from '@angular/core';
import { IPCService } from '../ipc.service';
import { filter, map, pairwise, tap } from 'rxjs';
import { OpenVRInputService } from '../openvr-input.service';
import {
  Empty,
  OverlayMenuOpenRequest,
  OyasumiSidecarControllerRole,
} from '../../../../src-grpc-web-client/overlay-sidecar_pb';
import { info } from 'tauri-plugin-log-api';
import { AppSettingsService } from '../app-settings.service';
import { APP_SETTINGS_DEFAULT, AppSettings } from '../../models/settings';
import { cloneDeep } from 'lodash';
import { OVRInputEventAction } from '../../models/ovr-input-event';

@Injectable({
  providedIn: 'root',
})
export class OverlayService {
  private overlaySidecarActive = this.ipcService.overlaySidecarClient.pipe(map(Boolean));
  private appSettings: AppSettings = cloneDeep(APP_SETTINGS_DEFAULT);

  constructor(
    private ipcService: IPCService,
    private openvrInput: OpenVRInputService,
    private appSettingsService: AppSettingsService
  ) {}

  async init() {
    this.appSettingsService.settings
      .pipe(
        // Store the settings on the service
        tap((settings) => (this.appSettings = settings)),
        // When disabling the overlay menu, close it if it's currently open
        pairwise(),
        filter(([previous, current]) => !current.overlayMenuEnabled && previous.overlayMenuEnabled),
        tap(() => {
          this.ipcService.getOverlaySidecarClient()?.closeOverlayMenu({} as Empty);
        })
      )
      .subscribe();
    // Detect action for toggling the overlay
    this.openvrInput.state
      .pipe(
        pairwise(),
        filter(() => this.appSettings.overlayMenuEnabled),
        map((states) => states.map((state) => state[OVRInputEventAction.OpenOverlay])),
        map(([previous, current]) =>
          current.find(
            (currentDevice) =>
              !previous.some((previousDevice) => previousDevice.index === currentDevice.index)
          )
        ),
        filter(Boolean),
        map((device) =>
          device.role === 'LeftHand'
            ? OyasumiSidecarControllerRole.Left
            : OyasumiSidecarControllerRole.Right
        )
      )
      .subscribe((controllerRole) => {
        info('[Overlay] Toggling overlay menu (controller action)');
        this.ipcService.getOverlaySidecarClient()?.toggleOverlayMenu({
          controllerRole,
        } as OverlayMenuOpenRequest);
      });
  }
}
