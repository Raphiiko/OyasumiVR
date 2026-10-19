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

  /** Opens `target="_blank"` links, and ctrl or shift clicked links, through open(). */
  init() {
    window.addEventListener('click', (e) => this.onClick(e), { capture: true });
  }

  /** Opens the URL in the default browser, and tells a user in the SteamVR dashboard it did. */
  async open(url: string) {
    try {
      await openUrl(url);
    } catch (e) {
      error(`[ExternalLink] Could not open ${url}: ${e}`);
      return;
    }
    if (await this.openvr.isDashboardVisible()) {
      this.toasts.show({ title: 'toasts.externalLink.opened' });
    }
  }

  private onClick(e: MouseEvent) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.altKey) return;
    const anchor = e
      .composedPath()
      .find((node): node is HTMLAnchorElement => node instanceof HTMLAnchorElement);
    if (!anchor?.href) return;
    if (anchor.target !== '_blank' && !e.ctrlKey && !e.shiftKey) return;
    const url = new URL(anchor.href);
    if (!EXTERNAL_PROTOCOLS.includes(url.protocol)) return;
    e.preventDefault();
    // tauri-plugin-shell and tauri-plugin-opener inject click handlers that would open it again
    e.stopPropagation();
    void this.open(url.href);
  }
}
