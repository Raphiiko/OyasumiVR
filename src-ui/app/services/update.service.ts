import { Injectable } from '@angular/core';
import { BehaviorSubject, filter, interval, switchMap, take } from 'rxjs';
import { relaunch } from '@tauri-apps/plugin-process';
import { ConfirmModalComponent } from '../components/confirm-modal/confirm-modal.component';
import { ModalService } from 'src-ui/app/services/modal.service';
import { UpdateModalComponent } from '../components/update-modal/update-modal.component';
import { FLAVOUR } from '../../build';
import { info } from '@tauri-apps/plugin-log';
import { Update } from '@tauri-apps/plugin-updater';

@Injectable({
  providedIn: 'root',
})
export class UpdateService {
  private _updateAvailable = new BehaviorSubject<{ checked: boolean; update?: Update }>({
    checked: false,
  });
  public updateAvailable = this._updateAvailable.asObservable();

  constructor(private modalService: ModalService) {}

  async init() {
    if (FLAVOUR === 'STANDALONE') {
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
  }

  async checkForUpdate(showDialog = false) {
    // Only ever check for updates in the STANDALONE flavour
    if (FLAVOUR !== 'STANDALONE') {
      this._updateAvailable.next({
        checked: true,
      });
      return;
    }
    // Check for updates
    info(`[Update] Checking for updates...`);
    // const update = (await check()) ?? undefined;
    const update = { version: '1.2.3', currentVersion: '1.2.2' } as Update;
    if (update) {
      info(
        `[Update] Update available! New version: ${update.version}, Current version: ${update.currentVersion}`
      );
    }
    this._updateAvailable.next({
      checked: true,
      update,
    });
    if (update && showDialog) {
      this.modalService
        .addModal(
          UpdateModalComponent,
          {
            update,
          },
          {
            closeOnEscape: false,
          }
        )
        .subscribe();
    }
  }

  async installUpdate() {
    const update = this._updateAvailable.value?.update;
    if (!update) return;
    info(`[Update] Installing update...`);
    try {
      update.downloadAndInstall((event) => {
        switch (event.event) {
          case 'Started':
          case 'Progress':
            break;
          case 'Finished':
            info(`[Update] Update complete. Relaunching...`);
            relaunch();
            return;
        }
      });
    } catch (error) {
      info(`[Update] Update error occurred: ${error}`);
      this.modalService
        .addModal(ConfirmModalComponent, {
          title: 'updater.modals.error.title',
          message: 'updater.modals.error.title',
          confirmButtonText: 'shared.modals.ok',
          showCancel: false,
        })
        .subscribe();
    }
  }
}
