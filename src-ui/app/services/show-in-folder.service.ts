import { inject, Injectable } from '@angular/core';
import { invoke } from '@tauri-apps/api/core';
import { appLogDir } from '@tauri-apps/api/path';
import { ToastService } from './toast.service';

@Injectable({ providedIn: 'root' })
export class ShowInFolderService {
  private toasts = inject(ToastService);

  /** Selects the file in a new Explorer window, and tells the user it opened on the desktop. */
  async show(path: string) {
    await invoke('show_in_folder', { path });
    this.toasts.show({ title: 'toasts.showInFolder.opened' });
  }

  async showLogFile() {
    await this.show(`${await appLogDir()}\\OyasumiVR.log`);
  }
}
