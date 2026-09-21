import { Injectable } from '@angular/core';
import { exit } from '@tauri-apps/plugin-process';
import { error, info } from '@tauri-apps/plugin-log';
import { filter, firstValueFrom, pairwise, take, timer } from 'rxjs';
import { AppSettingsService } from './app-settings.service';
import { OpenVRService } from './openvr.service';
import { ShutdownAutomationsService, ShutdownSequenceStage } from './shutdown-automations.service';
import { ToastOptions, ToastRef, ToastService } from './toast.service';

const QUIT_GRACE_PERIOD = 10_000;
const CANCELLED_TOAST_DURATION = 3_000;
const SHUTDOWN_CANCELLATION_WINDOW = 10_000;

@Injectable({
  providedIn: 'root',
})
export class QuitWithSteamVRService {
  private enabled = false;
  private pending = false;
  private generation = 0;
  private shutdownStage: ShutdownSequenceStage = 'IDLE';
  private ignoreSteamVRStopUntil = 0;
  private toast?: ToastRef;

  constructor(
    private appSettings: AppSettingsService,
    private openvr: OpenVRService,
    private shutdownAutomations: ShutdownAutomationsService,
    private toasts: ToastService
  ) {}

  async init() {
    this.appSettings.settings.subscribe((settings) => {
      if (this.enabled && !settings.quitWithSteamVR) this.cancelPendingQuit();
      this.enabled = settings.quitWithSteamVR;
    });
    this.shutdownAutomations.stage.subscribe((stage) => (this.shutdownStage = stage));
    this.shutdownAutomations.sequenceCancelled.subscribe(() => {
      const quittingSteamVR = this.shutdownStage === 'QUITTING_STEAMVR';
      if (quittingSteamVR) {
        this.ignoreSteamVRStopUntil = Date.now() + SHUTDOWN_CANCELLATION_WINDOW;
      }
      this.cancelPendingQuit('toasts.quitWithSteamVR.cancelled.shutdownSequence', quittingSteamVR);
    });
    this.openvr.status.pipe(pairwise()).subscribe(([previous, current]) => {
      if (previous === 'INITIALIZED' && current === 'INACTIVE') {
        if (Date.now() <= this.ignoreSteamVRStopUntil) {
          this.ignoreSteamVRStopUntil = 0;
          return;
        }
        this.ignoreSteamVRStopUntil = 0;
        void this.scheduleQuit().catch((cause) =>
          error(`[QuitWithSteamVR] Could not quit OyasumiVR: ${cause}`)
        );
      } else if (current !== 'INACTIVE') {
        this.ignoreSteamVRStopUntil = 0;
        this.cancelPendingQuit('toasts.quitWithSteamVR.cancelled.steamVRRestarted');
      }
    });
  }

  private async scheduleQuit() {
    if (!this.enabled) return;
    const generation = ++this.generation;
    this.pending = true;
    const gracePeriod = firstValueFrom(timer(QUIT_GRACE_PERIOD));
    this.toast?.dismiss();
    this.toast = this.toasts.show({
      type: 'warning',
      title: 'toasts.quitWithSteamVR.pending.title',
      message: 'toasts.quitWithSteamVR.pending.message',
      duration: QUIT_GRACE_PERIOD,
      dismissable: false,
      pauseOnHover: false,
    });

    await gracePeriod;
    if (!this.isCurrent(generation)) return;

    this.toast.update({
      type: 'pending',
      title: 'toasts.quitWithSteamVR.waiting.title',
      message: 'toasts.quitWithSteamVR.waiting.message',
      duration: 0,
    });
    await firstValueFrom(
      this.shutdownAutomations.stage.pipe(
        filter((stage) => stage === 'IDLE'),
        take(1)
      )
    );
    if (!this.isCurrent(generation)) return;

    this.pending = false;
    info('[QuitWithSteamVR] SteamVR has stopped: quitting OyasumiVR.');
    await exit(0);
  }

  private isCurrent(generation: number) {
    return this.pending && this.enabled && this.generation === generation;
  }

  private cancelPendingQuit(message?: string, showWithoutPending = false) {
    if (!this.pending && !showWithoutPending) return;
    const updateExisting = this.pending;
    this.pending = false;
    this.generation++;
    if (!message) {
      this.toast?.dismiss();
      return;
    }
    info('[QuitWithSteamVR] Pending quit cancelled.');
    const options: ToastOptions = {
      type: 'success',
      title: 'toasts.quitWithSteamVR.cancelled.title',
      message,
      duration: CANCELLED_TOAST_DURATION,
      dismissable: true,
      pauseOnHover: true,
      actions: [],
    };
    if (updateExisting) {
      this.toast?.update(options);
    } else {
      this.toast?.dismiss();
      this.toast = this.toasts.show(options);
    }
  }
}
