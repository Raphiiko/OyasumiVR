import { Injectable } from '@angular/core';
import { IPCService } from '../ipc.service';
import { filter, firstValueFrom, map, pairwise, switchMap, take, tap } from 'rxjs';
import { OpenVRInputService } from '../openvr-input.service';
import {
  Empty,
  OverlayMenuOpenRequest,
  OyasumiSidecarControllerRole,
} from '../../../../src-grpc-web-client/overlay-sidecar_pb';
import { info } from '@tauri-apps/plugin-log';
import { AppSettingsService } from '../app-settings.service';
import { APP_SETTINGS_DEFAULT, AppSettings } from '../../models/settings';

import { OVRInputEventAction } from '../../models/ovr-input-event';
import { invoke } from '@tauri-apps/api/core';
import { VRChatService } from '../vrchat.service';

@Injectable({
  providedIn: 'root',
})
export class OverlayService {
  public readonly sidecarStarted = this.ipcService.overlaySidecarClient.pipe(map(Boolean));
  private appSettings: AppSettings = structuredClone(APP_SETTINGS_DEFAULT);

  constructor(
    private ipcService: IPCService,
    private openvrInput: OpenVRInputService,
    private appSettingsService: AppSettingsService,
    private vrchat: VRChatService
  ) {}

  async init() {
    // Start the sidecar on launch
    this.appSettingsService.settings
      .pipe(
        take(1),
        map((config) => config.overlayGpuAcceleration),
        switchMap((gpuAcceleration) => this.startOrRestartSidecar(gpuAcceleration))
      )
      .subscribe();
    // Respond to settings changes
    this.appSettingsService.settings
      .pipe(
        // Store the settings on the service
        tap((settings) => (this.appSettings = settings)),
        pairwise(),
        tap(([previous, current]) => {
          // When disabling the overlay menu, close it if it's currently open
          if (!current.overlayMenuEnabled && previous.overlayMenuEnabled) {
            this.ipcService.getOverlaySidecarClient()?.closeOverlayMenu({} as Empty);
          }
          // When changing the GPU fix setting, restart the sidecar
          if (current.overlayGpuAcceleration !== previous.overlayGpuAcceleration) {
            this.startOrRestartSidecar(current.overlayGpuAcceleration);
          }
          // When enabling the overlay menu only open when VRChat is running setting, close the overlay menu if it's open
          if (
            current.overlayMenuOnlyOpenWhenVRChatIsRunning &&
            current.overlayMenuOnlyOpenWhenVRChatIsRunning !==
              previous.overlayMenuOnlyOpenWhenVRChatIsRunning
          ) {
            this.ipcService.getOverlaySidecarClient()?.closeOverlayMenu({} as Empty);
          }
        })
      )
      .subscribe();
    // Respond to VRChat process state changes
    this.vrchat.vrchatProcessActive.subscribe((active) => {
      // Close the overlay menu if it's open and VRChat is no longer active
      if (!active && this.appSettings.overlayMenuOnlyOpenWhenVRChatIsRunning) {
        this.ipcService.getOverlaySidecarClient()?.closeOverlayMenu({} as Empty);
      }
    });
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
      .subscribe(async (controllerRole) => {
        // Block opening if VRChat is not active (and the setting for that is enabled)
        if (this.appSettings.overlayMenuOnlyOpenWhenVRChatIsRunning) {
          const active = await firstValueFrom(this.vrchat.vrchatProcessActive);
          if (!active) return;
        }
        // Toggle the overlay
        info('[Overlay] Toggling overlay menu (controller action)');
        this.ipcService.getOverlaySidecarClient()?.toggleOverlayMenu({
          controllerRole,
        } as OverlayMenuOpenRequest);
      });
  }

  private async startOrRestartSidecar(gpuAcceleration: boolean) {
    await invoke('start_overlay_sidecar', { gpuAcceleration });
  }
}
