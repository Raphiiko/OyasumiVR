import { inject, Injectable } from '@angular/core';
import {
  open,
  OpenDialogOptions,
  OpenDialogReturn,
  save,
  SaveDialogOptions,
} from '@tauri-apps/plugin-dialog';
import { OpenVRService } from './openvr.service';
import { ToastService } from './toast.service';

/** Opens native file dialogs, and tells a user in the SteamVR dashboard that one opened on the desktop. */
@Injectable({ providedIn: 'root' })
export class FileDialogService {
  private openvr = inject(OpenVRService);
  private toasts = inject(ToastService);
  /** Set while a dialog is open, so a second click from the dashboard opens no second dialog. */
  private dialogOpen = false;

  open<T extends OpenDialogOptions>(options: T): Promise<OpenDialogReturn<T> | null> {
    return this.show(() => open(options), 'toasts.fileDialog.open');
  }

  save(options: SaveDialogOptions): Promise<string | null> {
    return this.show(() => save(options), 'toasts.fileDialog.save');
  }

  /** Resolves to null without a dialog while another dialog is still open. */
  private async show<T>(dialog: () => Promise<T>, toastTitle: string): Promise<T | null> {
    const alreadyOpen = this.dialogOpen;
    void this.notifyDashboardUser(toastTitle);
    if (alreadyOpen) return null;

    this.dialogOpen = true;
    try {
      return await dialog();
    } finally {
      this.dialogOpen = false;
    }
  }

  private async notifyDashboardUser(toastTitle: string) {
    if (await this.openvr.isDashboardVisible()) {
      this.toasts.show({ title: toastTitle });
    }
  }
}
