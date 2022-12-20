import { Injectable } from '@angular/core';
import { invoke } from '@tauri-apps/api';
import { warn } from 'tauri-plugin-log-api';

@Injectable({
  providedIn: 'root',
})
export class ImageCacheService {
  httpServerPort: number = 0;

  constructor() {}

  async init() {
    // Fetch http server port until it's available
    while (!this.httpServerPort) {
      this.httpServerPort = (await invoke<number>('get_http_server_port')) || 0;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  getImageUrl(remoteUrl: string, ttl: number = 3600) {
    if (!this.httpServerPort)
      warn('[ImageCache] Attempted getting url before http server port was initialized');
    return (
      'http://localhost:' +
      this.httpServerPort +
      '/image_cache/get?url=' +
      encodeURIComponent(remoteUrl) +
      '&ttl=' +
      ttl
    );
  }
}
