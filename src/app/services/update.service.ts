import { Injectable } from '@angular/core';
import { BehaviorSubject, filter, interval, Observable, switchMap, take } from 'rxjs';
import { checkUpdate, installUpdate, UpdateManifest } from '@tauri-apps/api/updater';
import { relaunch } from '@tauri-apps/api/process';
import { listen } from '@tauri-apps/api/event';
import { ConfirmModalComponent } from '../components/confirm-modal/confirm-modal.component';
import { ModalService } from 'src/app/services/modal.service';
import { UpdateModalComponent } from '../components/update-modal/update-modal.component';
import { getVersion } from '../utils/app-utils';
import { info } from 'tauri-plugin-log-api';

@Injectable({
  providedIn: 'root',
})
export class UpdateService {
  private _updateAvailable: BehaviorSubject<{ checked: boolean; manifest?: UpdateManifest }> =
    new BehaviorSubject<{ checked: boolean; manifest?: UpdateManifest }>({ checked: false });
  public updateAvailable: Observable<{ checked: boolean; manifest?: UpdateManifest }> =
    this._updateAvailable.asObservable();

  constructor(private modalService: ModalService) {}

  async init() {
    listen('tauri://update-status', (res) => {
      const event: { error?: any; status: 'ERROR' | 'PENDING' | 'DONE' } = res.payload as any;
      if (event.status === 'DONE') {
        info(`[Update] Update complete. Relaunching...`);
        relaunch();
        return;
      }
      if (event.status === 'ERROR') {
        info(`[Update] Update error occurred: ${event.error}`);
        this.modalService
          .addModal(ConfirmModalComponent, {
            title: 'updater.modals.error.title',
            message: 'updater.modals.error.title',
            confirmButtonText: 'shared.modals.ok',
            showCancel: false,
          })
          .subscribe();
      }
    });
    // Check for updates on start
    await this.checkForUpdate(true);
    // Check for updates every 7 days in case Oyasumi is left running for a long time.
    interval(1000 * 3600 * 24 * 7).subscribe(() => this.checkForUpdate());
    // Check for updates every 10 minutes until at least one update check has been done successfully.
    interval(1000 * 60 * 10)
      .pipe(
        switchMap(() => this._updateAvailable.pipe(take(1))),
        filter((info) => !info.checked)
      )
      .subscribe(() => this.checkForUpdate());
  }

  async checkForUpdate(showDialog = false) {
    // Don't ever update the dev version
    if ((await getVersion()) === 'DEV') {
      this._updateAvailable.next({
        checked: true,
      });
      return;
    }
    // Check for updates
    info(`[Update] Checking for updates...`);
    const { shouldUpdate, manifest } = await checkUpdate();
    if (shouldUpdate && manifest) {
      info(
        `[Update] Update available! New version: ${
          manifest.version
        }, Current version: ${await getVersion()}`
      );
    }
    this._updateAvailable.next({
      checked: true,
      manifest: (shouldUpdate && manifest) || undefined,
    });
    if (shouldUpdate && showDialog) {
      this.modalService
        .addModal(
          UpdateModalComponent,
          {
            manifest,
          },
          {
            closeOnEscape: false,
          }
        )
        .subscribe();
    }
  }

  async installUpdate() {
    info(`[Update] Installing update...`);
    await installUpdate();
    await relaunch();
  }
}
