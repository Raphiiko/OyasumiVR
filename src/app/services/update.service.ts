import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { checkUpdate, installUpdate, UpdateManifest } from '@tauri-apps/api/updater';
import { relaunch } from '@tauri-apps/api/process';
import { listen } from '@tauri-apps/api/event';
import { ConfirmModalComponent } from '../components/confirm-modal/confirm-modal.component';
import { SimpleModalService } from 'ngx-simple-modal';
import { UpdateModalComponent } from '../components/update-modal/update-modal.component';
import { getVersion } from '@tauri-apps/api/app';

@Injectable({
  providedIn: 'root',
})
export class UpdateService {
  private _updateAvailable: BehaviorSubject<{ checked: boolean; manifest?: UpdateManifest }> =
    new BehaviorSubject<{ checked: boolean; manifest?: UpdateManifest }>({ checked: false });
  public updateAvailable: Observable<{ checked: boolean; manifest?: UpdateManifest }> =
    this._updateAvailable.asObservable();

  constructor(private modalService: SimpleModalService) {}

  async init() {
    listen('tauri://update-status', (res) => {
      const event: { error?: any; status: 'ERROR' | 'PENDING' | 'DONE' } = res.payload as any;
      console.log('Update event', event);
      if (event.status === 'DONE') {
        relaunch();
        return;
      }
      if (event.status === 'ERROR') {
        console.error('Updater Error', event.error);
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
    await this.checkForUpdate(true);
  }

  async checkForUpdate(showDialog = false) {
    // Don't ever update the dev version
    // if ((await getVersion()) === '0.0.0') {
    //   this._updateAvailable.next({
    //     checked: true,
    //   });
    // }
    // Check for updates
    const { shouldUpdate, manifest } = await checkUpdate();
    this._updateAvailable.next({
      checked: true,
      manifest: (shouldUpdate && manifest) || undefined,
    });
    if (showDialog) {
      this.modalService
        .addModal(
          UpdateModalComponent,
          {
            manifest,
          },
          {
            closeOnEscape: false,
            closeOnClickOutside: false,
          }
        )
        .subscribe();
    }
  }

  async installUpdate() {
    await installUpdate();
    await relaunch();
  }
}
