import { inject } from '@angular/core';
import { MessageMonitor } from './message-monitor';
import { AppSettingsService } from '../../app-settings.service';
import { listen } from '@tauri-apps/api/event';
import {
  BehaviorSubject,
  combineLatest,
  debounceTime,
  distinctUntilChanged,
  map,
  skip,
} from 'rxjs';
import { isEqual } from 'lodash';
import { appLogDir } from '@tauri-apps/api/path';
import { invoke } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';

// the sidecar reports its start before it builds any overlays, so a crash loop reads as start then stop
const FAILED_STARTS_BEFORE_WARNING = 3;
const HEALTHY_AFTER_MS = 60000;

export class OverlaySidecarMessageMonitor extends MessageMonitor {
  private appSettings = inject(AppSettingsService);
  private failedStarts = new BehaviorSubject(0);
  private healthyTimeout?: ReturnType<typeof setTimeout>;

  public override async init(): Promise<void> {
    // count every start that fails to stay up
    await listen('OVERLAY_SIDECAR_STARTED', () => {
      clearTimeout(this.healthyTimeout);
      this.healthyTimeout = setTimeout(() => this.failedStarts.next(0), HEALTHY_AFTER_MS);
    });
    await listen('OVERLAY_SIDECAR_STOPPED', () => {
      clearTimeout(this.healthyTimeout);
      this.failedStarts.next(this.failedStarts.value + 1);
    });
    // changing this setting restarts the sidecar on purpose, so don't count that as a failure
    this.appSettings.settings
      .pipe(
        map((settings) => settings.overlayGpuAcceleration),
        distinctUntilChanged(),
        skip(1),
        // the restart it triggers reports its stop first, so reset after that arrives
        debounceTime(3000)
      )
      .subscribe(() => this.failedStarts.next(0));

    // warn once the failures pile up, offering the fix only when it is available
    combineLatest([
      this.failedStarts.pipe(map((count) => count >= FAILED_STARTS_BEFORE_WARNING)),
      this.appSettings.settings.pipe(map((settings) => settings.overlayGpuAcceleration)),
    ])
      .pipe(distinctUntilChanged(isEqual))
      .subscribe(([failing, gpuAcceleration]) => {
        if (!failing) {
          this.messageCenter.removeMessage('overlaySidecarKeepsFailing');
          return;
        }
        this.messageCenter.addMessage({
          id: 'overlaySidecarKeepsFailing',
          title: 'message-center.messages.overlaySidecarKeepsFailing.title',
          message: gpuAcceleration
            ? 'message-center.messages.overlaySidecarKeepsFailing.message.gpuAcceleration'
            : 'message-center.messages.overlaySidecarKeepsFailing.message.unknown',
          hideable: true,
          type: 'error',
          actions: gpuAcceleration
            ? [
                {
                  label:
                    'message-center.messages.overlaySidecarKeepsFailing.actions.disableGpuAcceleration',
                  action: () => {
                    this.appSettings.updateSettings({ overlayGpuAcceleration: false });
                  },
                },
              ]
            : [
                {
                  label: 'message-center.actions.openLogFolder',
                  action: async () => {
                    const path = (await appLogDir()) + '\\OyasumiVR_Core.log';
                    await invoke('show_in_folder', { path });
                  },
                },
                {
                  label: 'message-center.actions.supportDiscord',
                  action: () => openUrl('https://discord.gg/7MqdPJhYxC'),
                },
              ],
        });
      });
  }
}
