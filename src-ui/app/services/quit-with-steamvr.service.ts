import { Injectable } from '@angular/core';
import { exit } from '@tauri-apps/plugin-process';
import { error, info } from '@tauri-apps/plugin-log';
import { combineLatest, filter, firstValueFrom, pairwise, tap, timer } from 'rxjs';
import { AppSettingsService } from './app-settings.service';
import { OpenVRService, OpenVRStatus } from './openvr.service';
import { ShutdownAutomationsService, ShutdownSequenceStage } from './shutdown-automations.service';
import { ToastOptions, ToastRef, ToastService } from './toast.service';

const QUIT_GRACE_PERIOD = 10_000;
const CANCELLED_TOAST_DURATION = 3_000;

@Injectable({
  providedIn: 'root',
})
export class QuitWithSteamVRService {
  private enabled = false;
  private pending = false;
  /** Bumped on every schedule and cancel, so a stale `scheduleQuit` stops after its next await. */
  private generation = 0;
  private shutdownStage: ShutdownSequenceStage = 'IDLE';
  private steamVRStatus: OpenVRStatus = 'INACTIVE';
  /** Set when a cancelled shutdown sequence has already asked SteamVR to quit. */
  private ignoreNextSteamVRStop = false;
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

    this.shutdownAutomations.stage.subscribe((stage) => {
      if (this.shutdownStage === 'IDLE' && stage !== 'IDLE') this.ignoreNextSteamVRStop = false;
      this.shutdownStage = stage;
    });

    this.shutdownAutomations.sequenceCancelled.subscribe(() => this.onShutdownSequenceCancelled());

    this.openvr.status
      .pipe(
        tap((status) => (this.steamVRStatus = status)),
        pairwise()
      )
      .subscribe(([previous, current]) => this.onSteamVRStatusChange(previous, current));
  }

  private onShutdownSequenceCancelled() {
    const suppressStop =
      this.enabled &&
      this.shutdownStage === 'QUITTING_STEAMVR' &&
      this.steamVRStatus !== 'INACTIVE';
    if (suppressStop) this.ignoreNextSteamVRStop = true;
    this.cancelPendingQuit('toasts.quitWithSteamVR.cancelled.shutdownSequence', suppressStop);
  }

  private onSteamVRStatusChange(previous: OpenVRStatus, current: OpenVRStatus) {
    if (current === 'INITIALIZED') {
      this.cancelPendingQuit('toasts.quitWithSteamVR.cancelled.steamVRRestarted');
      return;
    }
    if (previous === 'INACTIVE' || current !== 'INACTIVE') return;

    // any stop consumes the suppression, even one that schedules no quit
    const ignoreStop = this.ignoreNextSteamVRStop;
    this.ignoreNextSteamVRStop = false;
    if (previous !== 'INITIALIZED' || ignoreStop) return;

    void this.scheduleQuit().catch((cause) =>
      error(`[QuitWithSteamVR] Could not quit OyasumiVR: ${cause}`)
    );
  }

  private async scheduleQuit() {
    if (!this.enabled) return;
    const generation = ++this.generation;
    this.pending = true;

    // count down the grace period
    this.toast?.dismiss();
    this.toast = this.toasts.show({
      type: 'warning',
      title: 'toasts.quitWithSteamVR.pending.title',
      message: 'toasts.quitWithSteamVR.pending.message',
      duration: QUIT_GRACE_PERIOD,
      dismissable: false,
      pauseOnHover: false,
      autoDismiss: false,
    });
    await firstValueFrom(timer(QUIT_GRACE_PERIOD));
    if (!this.isCurrent(generation)) return;

    // wait for the sequence to end and SteamVR to stay stopped
    if (this.shutdownStage !== 'IDLE') {
      this.toast.update({
        type: 'pending',
        title: 'toasts.quitWithSteamVR.waiting.title',
        message: 'toasts.quitWithSteamVR.waiting.message',
        duration: 0,
      });
    }
    await firstValueFrom(
      combineLatest([this.shutdownAutomations.stage, this.openvr.status]).pipe(
        filter(([stage, status]) => stage === 'IDLE' && status === 'INACTIVE')
      )
    );
    if (!this.isCurrent(generation)) return;

    // quit OyasumiVR
    this.toast.dismiss();
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
      autoDismiss: true,
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
