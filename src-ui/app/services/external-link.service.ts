import { inject, Injectable } from '@angular/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import { error } from '@tauri-apps/plugin-log';
import { OpenVRService } from './openvr.service';
import { ToastService } from './toast.service';

const EXTERNAL_PROTOCOLS = ['http:', 'https:', 'mailto:', 'tel:'];

@Injectable({ providedIn: 'root' })
export class ExternalLinkService {
  private openvr = inject(OpenVRService);
  private toasts = inject(ToastService);

  /**
   * Tells the user about clicked links, which the injected click handlers of tauri-plugin-shell
   * (`target="_blank"`) and tauri-plugin-opener (also ctrl or shift clicks) open in the browser.
   */
  init() {
    window.addEventListener('click', (e) => this.onClick(e));
  }

  /** Opens the URL in the default browser, and tells a user in the SteamVR dashboard it did. */
  async open(url: string) {
    try {
      await openUrl(url);
    } catch (e) {
      error(`[ExternalLink] Could not open ${url}: ${e}`);
      return;
    }
    await this.notifyOpened();
  }

  private onClick(e: MouseEvent) {
    if (e.button !== 0) return;
    const anchor = e
      .composedPath()
      .find((node): node is HTMLAnchorElement => node instanceof HTMLAnchorElement);
    if (!anchor?.href) return;
    if (!EXTERNAL_PROTOCOLS.includes(new URL(anchor.href).protocol)) return;
    const modifiedClick = (e.ctrlKey || e.shiftKey) && !e.metaKey && !e.altKey;
    if (anchor.target !== '_blank' && !modifiedClick) return;
    void this.notifyOpened();
  }

  private async notifyOpened() {
    if (await this.openvr.isDashboardVisible()) {
      this.toasts.show({ title: 'toasts.externalLink.opened' });
    }
  }
}
