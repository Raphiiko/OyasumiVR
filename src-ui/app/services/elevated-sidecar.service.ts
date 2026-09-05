import { Injectable } from '@angular/core';
import { invoke } from '@tauri-apps/api/core';
import { BehaviorSubject, firstValueFrom, Observable } from 'rxjs';
import { listen } from '@tauri-apps/api/event';
import { AppSettingsService } from './app-settings.service';
import { info } from '@tauri-apps/plugin-log';
import { ModalService } from './modal.service';
import {
  ConfirmModalComponent,
  ConfirmModalInputModel,
  ConfirmModalOutputModel,
} from '../components/confirm-modal/confirm-modal.component';

export type EnableResult =
  | { result: 'ok' }
  | { result: 'promptDeclined' }
  | { result: 'installFailed' }
  | { result: 'taskFailed'; reason: string }
  | { result: 'notSupported' };

export type DisableResult = { result: 'ok' } | { result: 'cleanupFailed'; reason: string };
export type ElevatedFeaturesOperation = 'idle' | 'enabling' | 'disabling';
export type ElevatedFeaturesFailure =
  | { operation: 'enable'; result: Exclude<EnableResult, { result: 'ok' }> }
  | { operation: 'disable'; result: Exclude<DisableResult, { result: 'ok' }> };

@Injectable({
  providedIn: 'root',
})
export class ElevatedSidecarService {
  private _sidecarStarted: BehaviorSubject<boolean> = new BehaviorSubject<boolean>(false);
  public sidecarStarted: Observable<boolean> = this._sidecarStarted.asObservable();
  private _operation = new BehaviorSubject<ElevatedFeaturesOperation>('idle');
  public operation = this._operation.asObservable();
  private _failure = new BehaviorSubject<ElevatedFeaturesFailure | null>(null);
  public failure = this._failure.asObservable();
  private operationQueue: Promise<unknown> = Promise.resolve();

  constructor(
    private appSettings: AppSettingsService,
    private modalService: ModalService
  ) {}

  async init() {
    this._sidecarStarted.next(await this.checkIfStarted());
    await Promise.all([
      listen<boolean>('ELEVATED_SIDECAR_STARTED', () => {
        info('[ElevatedSidecar] Elevated sidecar has started');
        this._sidecarStarted.next(true);
      }),
      listen<boolean>('ELEVATED_SIDECAR_STOPPED', () => {
        info('[ElevatedSidecar] Elevated sidecar has stopped');
        this._sidecarStarted.next(false);
      }),
    ]);
    if (
      !this._sidecarStarted.value &&
      (await firstValueFrom(this.appSettings.settings)).elevatedFeaturesEnabled
    ) {
      // Not awaited: enable can wait on a UAC prompt indefinitely, and app initialization quits
      // OyasumiVR when a step takes longer than 30 seconds.
      this.enable(false).catch((e) =>
        info(`[ElevatedSidecar] Could not enable elevated features: ${e}`)
      );
    }
  }

  // installs the privileged launcher if needed, repairs it if broken, then starts the sidecar
  enable(interactive = true): Promise<EnableResult> {
    return this.enqueue('enabling', () => this.enableNow(interactive));
  }

  private async enableNow(interactive: boolean): Promise<EnableResult> {
    const wasEnabled = this.appSettings.settingsSync.elevatedFeaturesEnabled;
    let result: EnableResult;
    do {
      result = await this.tryEnable();
      if (result.result === 'ok') {
        this.appSettings.updateSettings({ elevatedFeaturesEnabled: true });
        this._failure.next(null);
        return result;
      }
      if (interactive && result.result !== 'promptDeclined') {
        if (await this.showFailure('enable', result)) continue;
      }
      break;
    } while (true);

    if (!wasEnabled || interactive || ['promptDeclined', 'notSupported'].includes(result.result)) {
      this.appSettings.updateSettings({ elevatedFeaturesEnabled: false });
    }
    if (!interactive && result.result !== 'promptDeclined') {
      this._failure.next({ operation: 'enable', result });
    }
    return result;
  }

  private async tryEnable(): Promise<EnableResult> {
    let result: EnableResult;
    try {
      result = await invoke<EnableResult>('elevated_features_enable');
    } catch (e) {
      info(`[ElevatedSidecar] Could not enable elevated features: ${e}`);
      return { result: 'installFailed' };
    }
    if (result.result !== 'ok') {
      info(`[ElevatedSidecar] Could not enable elevated features: ${result.result}`);
    }
    return result;
  }

  disable(interactive = true): Promise<DisableResult> {
    return this.enqueue('disabling', () => this.disableNow(interactive));
  }

  private async disableNow(interactive: boolean): Promise<DisableResult> {
    let result: DisableResult;
    do {
      this.appSettings.updateSettings({ elevatedFeaturesEnabled: false });
      result = await this.tryDisable();
      if (result.result === 'ok') {
        this._failure.next(null);
        return result;
      }
      this._failure.next({ operation: 'disable', result });
      if (!interactive || !(await this.showFailure('disable', result))) return result;
    } while (true);
  }

  private async tryDisable(): Promise<DisableResult> {
    let result: DisableResult;
    try {
      result = await invoke<DisableResult>('elevated_features_disable');
    } catch (e) {
      result = { result: 'cleanupFailed', reason: String(e) };
    }
    if (result.result !== 'ok') {
      info(`[ElevatedSidecar] Could not disable elevated features: ${result.reason}`);
      return result;
    }
    return result;
  }

  private enqueue<T>(
    operation: Exclude<ElevatedFeaturesOperation, 'idle'>,
    task: () => Promise<T>
  ): Promise<T> {
    const run = this.operationQueue.then(async () => {
      this._operation.next(operation);
      try {
        return await task();
      } finally {
        this._operation.next('idle');
      }
    });
    this.operationQueue = run.catch(() => undefined);
    return run;
  }

  private async showFailure(
    operation: 'enable' | 'disable',
    result: Exclude<EnableResult | DisableResult, { result: 'ok' }>
  ): Promise<boolean> {
    const retryable = result.result !== 'notSupported';
    const modalResult = await firstValueFrom(
      this.modalService.addModal<ConfirmModalInputModel, ConfirmModalOutputModel>(
        ConfirmModalComponent,
        {
          title: `settings.general.adminPrivileges.dialogs.${operation}Failed.title`,
          message: `settings.general.adminPrivileges.errors.${result.result}`,
          confirmButtonText: retryable ? 'shared.modals.retry' : 'shared.modals.close',
          cancelButtonText: 'shared.modals.close',
          showCancel: retryable,
        },
        { closeOnEscape: !retryable }
      )
    );
    return retryable && (modalResult?.confirmed ?? false);
  }

  async checkIfStarted(): Promise<boolean> {
    return await invoke('elevated_sidecar_started');
  }
}
