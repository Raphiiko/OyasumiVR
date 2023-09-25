import { Injectable } from '@angular/core';
import { listen } from '@tauri-apps/api/event';
import { warn } from 'tauri-plugin-log-api';

@Injectable({
  providedIn: 'root',
})
export class DeepLinkService {
  constructor() {}

  async init() {
    await listen<string>('onDeepLinkCall', async (event) => {
      let url: URL | null = null;
      try {
        url = new URL(event.payload);
      } catch (e) {
        await warn(`[DeepLinkService] Failed to parse deep link URL: ${event.payload}`);
        return;
      }
      await this.handleDeepLinkCall(url);
    });
  }

  private async handleDeepLinkCall(url: URL) {}
}
