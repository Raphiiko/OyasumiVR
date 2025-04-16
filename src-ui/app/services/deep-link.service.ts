import { Injectable } from '@angular/core';
import { listen } from '@tauri-apps/api/event';
import { info, warn } from '@tauri-apps/plugin-log';
import { PulsoidService } from './integrations/pulsoid.service';
import { onOpenUrl } from '@tauri-apps/plugin-deep-link';

@Injectable({
  providedIn: 'root',
})
export class DeepLinkService {
  constructor(private pulsoid: PulsoidService) {}

  async init() {
    await onOpenUrl(async (urls) => {
      for (let strurl of urls) {
        let url: URL | null = null;
        info(`[DeepLinkService] Received deep link call: ${strurl}`);
        try {
          url = new URL(strurl);
        } catch (e) {
          await warn(`[DeepLinkService] Failed to parse deep link URL: ${strurl}`);
          return;
        }
        try {
          await this.handleDeepLinkCall(url);
        } catch (e) {
          await warn(`[DeepLinkService] Failed to handle deep link call for URL: ${strurl}`);
        }
      }
    });
  }

  private async handleDeepLinkCall(url: URL) {
    let pathname = url.pathname;
    // Remove any leading slashes
    while (pathname.startsWith('/')) pathname = pathname.substring(1);
    const route = [url.hostname, ...pathname.split('/')].map((p) => p.trim()).filter(Boolean);
    switch (route[0]) {
      case 'integration':
        if (route.length < 2) break;
        await this.handleDeepLinkByIntegration(
          route[1],
          '/' + route.slice(2).join('/'),
          Array.from(url.searchParams.entries()).reduce((acc, e) => {
            if (!acc[e[0]]) acc[e[0]] = [];
            acc[e[0]].push(e[1]);
            return acc;
          }, {} as Record<string, string[]>),
          url.hash.substring(1)
        );
        break;
      default:
        await warn(`[DeepLinkService] Couldn't handle deep link type: ${route[0]}`);
        await warn(`[DeepLinkService] - href: ${url.href}`);
        await warn(`[DeepLinkService] - hostname: ${url.hostname}`);
        await warn(`[DeepLinkService] - pathname: ${url.pathname}`);
    }
  }

  private async handleDeepLinkByIntegration(
    integration: string,
    path: string,
    params: Record<string, string[]>,
    fragment: string
  ) {
    const fragmentParams: Record<string, string[]> = {};
    try {
      for (const [key, value] of new URLSearchParams(fragment)) {
        if (fragmentParams.hasOwnProperty(key)) fragmentParams[key].push(value);
        else fragmentParams[key] = [value];
      }
    } catch (e) {
      // It's ok if we can't parse the fragment
    }
    switch (integration) {
      case 'pulsoid':
        await this.pulsoid.handleDeepLink(path, params, fragmentParams);
        break;
      default:
        await warn(`[DeepLinkService] Couldn't handle deep link for integration: ${integration}`);
    }
  }
}
