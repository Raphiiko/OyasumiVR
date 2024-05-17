import { Injectable } from '@angular/core';
import { invoke } from '@tauri-apps/api';
import { BehaviorSubject } from 'rxjs';

@Injectable({
  providedIn: 'root',
})
export class ImageCacheService {
  httpServerPort = new BehaviorSubject<number | null>(null);

  constructor() {}

  async init() {
    // Fetch http server port until it's available
    while (!this.httpServerPort.value) {
      const port = (await invoke<number>('get_http_server_port')) || null;
      if (port) this.httpServerPort.next(port);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  getImageUrl(remoteUrl: string, ttl = 3600) {
    if (!this.httpServerPort.value) return '';
    return (
      'http://localhost:' +
      this.httpServerPort.value +
      '/image_cache/get?url=' +
      encodeURIComponent(remoteUrl) +
      '&ttl=' +
      ttl
    );
  }
}
